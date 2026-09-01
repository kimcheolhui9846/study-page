/**
 * 점수 → 상태 · 다음 행동.
 *
 * 설계안 §8.2 의 표를 코드로 옮긴 것이다. 순수 함수라 전부 테스트된다.
 */

export const MASTERY_STATUSES = [
  'not_started', 'learning', 'weak', 'reviewing', 'mastered',
] as const
export type MasteryStatus = (typeof MASTERY_STATUSES)[number]

export interface Outcome {
  status: MasteryStatus
  /** 후속 Topic 을 열어도 되는가 */
  advances: boolean
  /** 내일 복습을 넣을 것인가 */
  reviewTomorrow: boolean
  /** 선수를 거슬러 보충을 찾을 것인가 */
  needsRemediation: boolean
  /** 간격 반복을 예약할 것인가 */
  scheduleSpacedReview: boolean
}

/**
 * ★ "다음 진도 보류"는 **그 Topic 을 선수로 갖는 것만** 막는다.
 * 다른 갈래와 다른 과목은 계속 나아간다 — 그래야
 * "특정 과목이 부족해도 다른 과목은 독립적으로"가 성립한다.
 * 그 범위 제한은 계획 엔진이 그래프로 처리하고, 여기서는 신호만 낸다.
 */
export function outcomeFor(score: number): Outcome {
  if (score >= 90) {
    return {
      status: 'mastered',
      advances: true,
      reviewTomorrow: false,
      needsRemediation: false,
      scheduleSpacedReview: true,
    }
  }
  if (score >= 75) {
    return {
      status: 'mastered',
      advances: true,
      reviewTomorrow: false,
      needsRemediation: false,
      scheduleSpacedReview: true,
    }
  }
  if (score >= 60) {
    // 나아가되 내일 한 번 더 본다. 굳지 않은 채로 쌓이면 나중에 무너진다.
    return {
      status: 'reviewing',
      advances: true,
      reviewTomorrow: true,
      needsRemediation: false,
      scheduleSpacedReview: true,
    }
  }
  if (score >= 40) {
    return {
      status: 'weak',
      advances: false,
      reviewTomorrow: true,
      needsRemediation: true,
      scheduleSpacedReview: false,
    }
  }
  return {
    status: 'weak',
    advances: false,
    reviewTomorrow: true,
    needsRemediation: true,
    scheduleSpacedReview: false,
  }
}

/**
 * 후속 Topic 이 열렸는지 본다.
 *
 * 선수 전부가 각자의 passThreshold 를 넘어야 한다. 하나라도 모자라면
 * 그 Topic 은 아직 후보가 아니다.
 */
export function isUnlocked(
  prerequisites: Array<{ score: number; passThreshold: number }>,
): boolean {
  return prerequisites.every((p) => p.score >= p.passThreshold)
}

/** 열리지 못하게 막고 있는 선수만 골라낸다. 보충 후보이자 화면의 설명이다. */
export function blockingPrerequisites<T extends { score: number; passThreshold: number }>(
  prerequisites: T[],
): T[] {
  return prerequisites.filter((p) => p.score < p.passThreshold)
}
