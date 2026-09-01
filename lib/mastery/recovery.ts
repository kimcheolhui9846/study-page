/**
 * 못 넘긴 Topic 을 어떻게 회복시킬 것인가.
 *
 * ★ 사용자가 정한 정책 (2026-09-02):
 *   "복습 기회는 1번 정도 주고, 복습할 때도 틀리면 그 하위 개념으로 공부하고,
 *    하위 개념 통과 시 다시 복습 진행 후, 맞든 틀리든 다음 학습 진도로 진행"
 *
 * 이 정책이 필요한 이유는 그 전의 동작이 이랬기 때문이다: 계속 틀리는 Topic 은
 * 우선순위 계산의 wrongCount 항(최대 400점)에 밀려 매일 최상위로 올라왔고,
 * 취약 재학습은 콘텐츠를 새로 안 만들어 예산에도 안 걸렸다. 그래서 한 과목이
 * 막히면 30일 중 대부분이 그 과목의 재시도로 채워졌다.
 *
 * 이제 한 Topic 이 일정을 잡아둘 수 있는 시도는 **최대 3번**이다.
 */

/** 한 Topic 을 붙잡고 있을 수 있는 최대 시도 횟수 */
export const MAX_ATTEMPTS = 3

/**
 * 접어둔 Topic 이 다시 돌아오기까지의 날 수.
 *
 * 영원히 버리지 않는 이유: 못 넘긴 Topic 이 core 선수면 그 아래 가지가
 * 통째로 잠긴다. "다음 진도로 진행"은 지금 비켜준다는 뜻이지 영영
 * 포기한다는 뜻이 아니다. 간격 반복의 마지막 간격과 같은 2주로 둔다.
 */
export const PARK_DAYS = 14

export type RecoveryPhase =
  /** 스스로 한 번 더. 원래 지문을 다시 읽는다 (생성 0회) */
  | 'retry'
  /** 하위 개념으로 내려간다. 이 Topic 은 오늘 하지 않는다 */
  | 'remediation'
  /** 하위를 넘겼으니 다시 한 번. 이 결과와 무관하게 다음 진도로 간다 */
  | 'final-retry'
  /** 접어둔다. 오늘 일정에 넣지 않는다 */
  | 'parked'

export interface RecoveryTarget {
  id: string
  score: number
  passThreshold: number
}

export interface RecoveryInput {
  /** 이 Topic 을 지금까지 몇 번 공부했나 (topic_progress.attempt_count) */
  attemptCount: number
  /** 내려갈 하위 개념. 못 넘긴 선수와 보충 Topic */
  targets: RecoveryTarget[]
  /** 이 Topic 을 마지막으로 공부한 지 며칠. 한 번도 안 했으면 null */
  daysSinceStudied: number | null
}

export interface Recovery {
  phase: RecoveryPhase
  /** remediation 일 때 먼저 해야 할 하위 개념들. 점수가 낮은 순 */
  blocking: RecoveryTarget[]
}

/**
 * 지금 이 Topic 을 어떻게 다뤄야 하는가.
 *
 * `attemptCount` 가 곧 단계다 — 별도의 상태 칼럼을 만들지 않았다.
 * 같은 사실을 두 곳에 두면 어긋났을 때 진실을 정할 수 없다.
 */
export function recoveryPhaseOf(input: RecoveryInput): Recovery {
  const blocking = input.targets
    .filter((t) => t.score < t.passThreshold)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))

  // 접어둔 지 오래됐으면 한 바퀴 다시 준다.
  const rested = input.daysSinceStudied !== null && input.daysSinceStudied >= PARK_DAYS

  // 첫 실패 뒤의 한 번. 사용자가 말한 "복습 기회 1번"이 여기다.
  if (input.attemptCount <= 1) return { phase: 'retry', blocking }

  if (input.attemptCount >= MAX_ATTEMPTS) {
    return rested ? { phase: 'retry', blocking } : { phase: 'parked', blocking }
  }

  // attemptCount === 2 — 복습에서도 틀렸다.
  // 내려갈 하위 개념이 아예 없으면 붙잡아 둘 이유가 없다.
  if (input.targets.length === 0) {
    return rested ? { phase: 'retry', blocking } : { phase: 'parked', blocking }
  }

  if (blocking.length > 0) return { phase: 'remediation', blocking }

  // 하위를 다 넘겼다. 마지막 한 번.
  return { phase: 'final-retry', blocking }
}

/** 오늘 이 Topic 을 일정에 넣는가. */
export function isSchedulable(phase: RecoveryPhase): boolean {
  return phase !== 'parked'
}
