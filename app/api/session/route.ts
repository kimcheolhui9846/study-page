import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { isHashFormatValid, verifyPassword } from '@/lib/auth/password'
import { isLockedOut, recordAttempt } from '@/lib/auth/lockout'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  // 잠금을 비밀번호 검증보다 먼저 본다 — 잠긴 동안은 scrypt 를 돌리지도 않는다
  if (await isLockedOut(db, systemClock)) {
    return NextResponse.json(
      { error: 'LOCKED_OUT', message: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.' },
      { status: 429 },
    )
  }

  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  const stored = process.env.AUTH_PASSWORD_HASH ?? ''

  // 설정이 망가진 것과 비밀번호가 틀린 것은 응답으로는 구분하지 않는다.
  // 밖에 설정 상태를 알려줄 이유가 없다. 다만 서버 로그에는 구분해서 남긴다 —
  // 이게 없으면 "모든 비밀번호가 거부되는데 이유를 모르는" 상황에 빠진다.
  if (!isHashFormatValid(stored)) {
    console.error(
      stored
        ? 'AUTH_PASSWORD_HASH 의 형식이 깨졌습니다. scrypt.N.r.p.salt.hash 여야 합니다. ' +
          'npm run hash:password 로 다시 만드세요.'
        : 'AUTH_PASSWORD_HASH 가 설정되지 않았습니다.',
    )
  }

  if (!verifyPassword(password, stored)) {
    await recordAttempt(db, systemClock, false, ip)
    return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 })
  }

  await recordAttempt(db, systemClock, true, ip)

  const { token, expiresAt } = await new PostgresSessionStore(db, systemClock).create()

  const res = NextResponse.json({ expiresAt: expiresAt.toISOString() })
  res.cookies.set('sid', token, {
    httpOnly: true,                                   // JS 가 읽을 수 없다
    secure: process.env.NODE_ENV === 'production',    // 로컬 http 개발을 위해 조건부
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
  return res
}
