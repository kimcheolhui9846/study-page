import { kstToday } from '../time'

/**
 * 간격 반복 복습 예약.
 *
 * 회차가 Topic 의 `reviewIntervals` 길이로 제한된다 (기본 4회).
 * **그것이 곧 복습 콘텐츠 생성 상한이다** — `review_items UNIQUE(topic_id, round)`
 * 와 짝을 이뤄 무한 생성을 원리적으로 막는다.
 */

export interface ReviewState {
  /** 지금까지 마친 복습 회차. 0 이면 아직 한 번도 안 했다 */
  round: number
  /** 다음 복습 예정일 'YYYY-MM-DD'. null 이면 예정 없음 */
  nextReviewAt: string | null
}

function addDays(dateStr: string, days: number): string {
  // 날짜 문자열만 다룬다. Date 산술에 시간대가 끼어들지 않게 UTC 정오를 기준점으로 쓴다.
  const base = new Date(`${dateStr}T12:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/**
 * 다음 복습을 예약한다.
 *
 * 마지막 회차까지 마쳤으면 더 예약하지 않는다 — `nextReviewAt: null`.
 * 그 Topic 은 간격 반복을 졸업한 것이고, 다시 틀리면 그때 새로 시작한다.
 */
export function scheduleNext(
  state: ReviewState, intervals: number[], now: Date,
): ReviewState {
  const nextRound = state.round + 1
  if (nextRound > intervals.length) {
    return { round: state.round, nextReviewAt: null }
  }
  return {
    round: nextRound,
    nextReviewAt: addDays(kstToday(now), intervals[nextRound - 1]),
  }
}

/**
 * 다시 틀렸을 때. 간격 반복을 처음부터 시작한다.
 *
 * 회차를 유지한 채 재개하면 "14일 뒤"부터 다시 보게 되는데,
 * 방금 틀린 개념을 2주 뒤에 보는 것은 복습이 아니라 방치다.
 */
export function resetSchedule(intervals: number[], now: Date): ReviewState {
  return { round: 1, nextReviewAt: addDays(kstToday(now), intervals[0] ?? 1) }
}

/** 오늘 기한이 됐거나 지났는가. */
export function isDue(nextReviewAt: string | null, now: Date): boolean {
  if (nextReviewAt === null) return false
  return nextReviewAt <= kstToday(now)
}

/** 며칠 밀렸는가. 우선순위 계산이 쓴다. 음수는 아직 안 됐다는 뜻이라 0 으로 본다. */
export function daysOverdue(nextReviewAt: string | null, now: Date): number {
  if (nextReviewAt === null) return 0

  const today = new Date(`${kstToday(now)}T12:00:00Z`).getTime()
  const due = new Date(`${nextReviewAt}T12:00:00Z`).getTime()
  return Math.max(0, Math.round((today - due) / 86_400_000))
}
