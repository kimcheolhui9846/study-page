import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { readSidCookie } from '@/lib/session/guard'

/**
 * 종료 버튼과 pagehide 의 sendBeacon 이 함께 쓴다.
 *
 * beacon 은 중복 도착하거나 아예 안 올 수 있으므로 멱등하고 항상 204 를 준다.
 * 브라우저 닫힘은 서버가 보장할 수 없다 — 확실한 안전망은 유휴 15분 타임아웃이다.
 *
 * withSession 가드를 쓰지 않는다. 이미 만료된 세션을 끊으려는 요청도
 * 쿠키를 지우고 정상 종료로 처리해야 하기 때문이다.
 */
export async function POST(req: NextRequest) {
  const token = readSidCookie(req)
  if (token) {
    await new PostgresSessionStore(db, systemClock).revoke(token)
  }

  const res = new NextResponse(null, { status: 204 })
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
