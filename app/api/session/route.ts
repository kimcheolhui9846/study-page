import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { verifyPassword } from '@/lib/auth/password'
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
