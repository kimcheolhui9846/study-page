/**
 * 세션 바의 카운트다운 판정. 순수 함수만 둔다.
 *
 * 컴포넌트 안에 두면 테스트하려고 DOM 스택을 들여야 한다. 실제로 사고가 난
 * 곳은 렌더링이 아니라 이 판정들이었으므로, 여기로 꺼내서 테스트한다.
 */

export const WARN_MS = 2 * 60 * 1000 // 앰버로 바뀌는 지점
export const CRITICAL_MS = 30 * 1000 // 테라코타로 바뀌는 지점

export type Stage = 'normal' | 'warn' | 'critical' | 'expired'

export function stageOf(remaining: number): Stage {
  if (remaining <= 0) return 'expired'
  if (remaining <= CRITICAL_MS) return 'critical'
  if (remaining <= WARN_MS) return 'warn'
  return 'normal'
}

export function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 만료 판정은 시계로 한다. 화면에 그려진 남은 시간(state)으로 하지 않는다.
 *
 * ★ 여기서 사고가 났다. 예전에는 `remaining <= 0` 으로 판정했는데,
 * 서버 응답이 도착해 deadline 이 채워진 그 렌더에서 remaining 은 아직
 * 초기값 0 이다 — 1초 틱이 아직 돌지 않았기 때문이다. 그래서 방금 받아온
 * 15분짜리 세션을 "만료됨"으로 보고 /login 으로 보냈고, /login 은 세션이
 * 살아 있으니 / 로 되돌렸다. 무한 루프가 됐고, 매 사이클마다 세션 바가
 * 다시 마운트되며 /api/session/status 를 때렸다 — 넣지 않기로 한
 * 하트비트를 버그가 만들어낸 셈이다.
 *
 * deadline 이 아직 없으면(=서버 답을 못 받았으면) 만료가 아니다.
 * 모른다는 것과 끝났다는 것은 다르다.
 */
export function isExpired(deadline: number | null, now: number): boolean {
  if (deadline === null) return false
  return now >= deadline
}

/** 두 만료 중 먼저 오는 쪽이 실제 남은 시간이다. */
export function earlierDeadline(idleExpiresAt: string, expiresAt: string): number {
  return Math.min(new Date(idleExpiresAt).getTime(), new Date(expiresAt).getTime())
}
