import type { GuardedHandler } from './guard'

/**
 * 세션 바가 카운트다운을 그릴 근거를 준다.
 *
 * ★ 이 라우트를 폴링하면 안 된다. 가드가 통과할 때마다 유휴 만료를 밀기
 * 때문에, 주기적으로 부르면 넣지 않기로 한 하트비트가 뒷문으로 들어온다
 * (`docs/DECISIONS.md`). 세션 바는 마운트 때 한 번만 부르고, 그 뒤로는
 * 받아온 시각과 로컬 시계의 차이만 그린다.
 */
export const sessionStatusHandler: GuardedHandler = async (_req, session) =>
  Response.json({
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
  })
