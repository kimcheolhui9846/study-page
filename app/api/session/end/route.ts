import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { readSidCookie } from '@/lib/session/guard'

/**
 * [종료] 버튼 전용. 즉시 파기한다.
 *
 * pagehide 의 beacon 은 여기가 아니라 /api/session/leaving 으로 간다.
 * 브라우저가 "닫힘"과 "새로고침"을 구분해 주지 않기 때문이다 —
 * 여기로 보내면 새로고침이 곧 로그아웃이 된다 (DECISIONS 참조).
 * 사용자가 버튼을 누른 것은 의도가 분명하므로 즉시 파기가 맞다.
 *
 * 멱등하고 항상 204 를 준다.
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
