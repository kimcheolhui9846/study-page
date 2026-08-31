import { db } from '../db/client'
import { systemClock } from '../time'
import { PostgresSessionStore } from './postgres'
import type { Session, SessionStore } from './store'

/** Next 16 의 라우트 컨텍스트. params 는 Promise 다. */
export interface RouteContext<P = Record<string, string>> {
  params: Promise<P>
}

export type GuardedHandler<P = Record<string, string>> = (
  req: Request,
  session: Session,
  ctx: RouteContext<P>,
) => Promise<Response>

export function readSidCookie(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null

  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    // 이름은 정확히 'sid' 여야 한다. 'not_sid' 를 잘라 붙여 착각하면 안 된다.
    if (trimmed.slice(0, eq) !== 'sid') continue
    // 값에 '=' 가 있을 수 있다(base64url 패딩). 첫 '=' 뒤 전부가 값이다.
    return trimmed.slice(eq + 1) || null
  }
  return null
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: 'SESSION_EXPIRED',
      message: '세션이 만료되었습니다. 다시 로그인하세요.',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        // 죽은 쿠키를 남겨두지 않는다 — 다음 요청이 헛되이 DB를 때린다
        'set-cookie': 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    },
  )
}

/**
 * 스토어를 주입받는 가드 팩토리. 테스트가 이걸 쓴다.
 *
 * ctx 를 핸들러까지 그대로 넘긴다 — 동적 라우트의 params 가 여기 들어 있고
 * Next 16 에서 그것은 Promise 다.
 */
export function makeGuard(store: SessionStore) {
  return <P = Record<string, string>>(handler: GuardedHandler<P>) =>
    async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
      const token = readSidCookie(req)
      if (!token) return unauthorized()

      const session = await store.verifyAndTouch(token)
      if (!session) return unauthorized()

      return handler(req, session, ctx)
    }
}

/** 프로덕션 스토어가 묶인 가드. 모든 보호 라우트의 단일 입구다. */
export const withSession = makeGuard(new PostgresSessionStore(db, systemClock))
