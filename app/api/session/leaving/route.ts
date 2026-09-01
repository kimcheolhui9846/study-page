import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { LEAVING_GRACE_MS } from '@/lib/session/store'
import { readSidCookie } from '@/lib/session/guard'

/**
 * 탭이 사라질 때 pagehide 의 sendBeacon 이 부른다. 세션을 파기하지 않는다.
 *
 * ★ /api/session/end 와 다른 라우트인 이유가 있다.
 *
 * 브라우저는 "창을 닫았다"와 "새로고침했다"를 구분해 주지 않는다 —
 * pagehide 는 둘 다에서 똑같이 발생한다. 여기서 파기하면 새로고침이
 * 곧 로그아웃이 된다. 대신 유휴 만료를 30초로 당긴다:
 *
 *   정말 닫았으면   → 아무 요청도 오지 않고 30초 뒤 죽는다
 *   새로고침이면    → 새 페이지의 첫 요청이 다시 15분으로 민다
 *
 * 쿠키를 지우지 않는다. 지우면 새로고침한 페이지가 세션을 잃는다.
 *
 * beacon 은 중복 도착하거나 아예 안 올 수 있으므로 멱등하고 항상 204 다.
 * 확실한 안전망은 여전히 서버의 유휴 타임아웃이다.
 */
export async function POST(req: NextRequest) {
  const token = readSidCookie(req)
  if (token) {
    await new PostgresSessionStore(db, systemClock).expireSoon(token, LEAVING_GRACE_MS)
  }
  return new NextResponse(null, { status: 204 })
}
