import { eq } from 'drizzle-orm'
import { topicProgress } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import { loadGraph } from '../curriculum/load'
import { masteryScore } from './score'
import { outcomeFor } from './transition'
import { resetSchedule, scheduleNext } from './schedule'

/**
 * 학습 결과를 숙련도에 반영한다.
 *
 * ★ 이 함수가 "어제 틀린 것이 오늘 배울 것을 바꾼다"의 실제 지점이다.
 * 여기서 쓴 값을 내일 계획 엔진이 읽는다.
 *
 * LLM 을 부르지 않는다. 채점 근거(맞은/놓친 포인트)를 받아 숫자로 바꾸는
 * 일은 전부 순수 함수다.
 */

export interface ApplyInput {
  topicId: string
  correctPoints: number
  missedPoints: number
  usedHint?: boolean
  /** 채점이 지목한 취약 개념. 모델의 제안이고 누적만 한다 */
  weakConcepts?: string[]
}

export interface ApplyResult {
  topicId: string
  score: number
  previousScore: number | null
  status: string
  advances: boolean
  nextReviewAt: string | null
  reviewRound: number
}

export async function applyResult(
  db: Db, clock: Clock, input: ApplyInput,
): Promise<ApplyResult> {
  const now = clock.now()
  const topic = loadGraph().topics.get(input.topicId)
  if (!topic) throw new Error(`없는 Topic 입니다: ${input.topicId}`)

  const [prev] = await db.select().from(topicProgress)
    .where(eq(topicProgress.topicId, input.topicId))

  const score = masteryScore({
    correctPoints: input.correctPoints,
    missedPoints: input.missedPoints,
    difficulty: topic.difficulty,
    usedHint: input.usedHint ?? false,
    repeatedMistake: (prev?.wrongCount ?? 0) > 0,
    previousScore: prev?.masteryScore,
  })

  const outcome = outcomeFor(score)

  // 간격 반복을 이어갈지, 처음부터 다시 할지.
  // 못 넘겼으면 다시 시작한다 — 방금 틀린 것을 2주 뒤에 보는 건 방치다.
  const sched = outcome.scheduleSpacedReview
    ? scheduleNext(
        { round: prev?.reviewRound ?? 0, nextReviewAt: prev?.nextReviewAt ?? null },
        topic.reviewIntervals, now,
      )
    : resetSchedule(topic.reviewIntervals, now)

  const wrong = (prev?.wrongCount ?? 0) + (score < 60 ? 1 : 0)
  const correct = (prev?.correctCount ?? 0) + (score >= 60 ? 1 : 0)

  // 취약 개념은 합집합으로 누적한다. 같은 개념을 여러 번 틀려도 한 번만 남는다.
  const merged = [...new Set([
    ...((prev?.weakConcepts as string[] | undefined) ?? []),
    ...(input.weakConcepts ?? []),
  ])]

  const row = {
    topicId: input.topicId,
    status: outcome.status,
    masteryScore: score,
    attemptCount: (prev?.attemptCount ?? 0) + 1,
    correctCount: correct,
    wrongCount: wrong,
    weakConcepts: merged,
    lastStudiedAt: now,
    nextReviewAt: sched.nextReviewAt,
    reviewRound: sched.round,
  }

  await db.insert(topicProgress).values(row)
    .onConflictDoUpdate({ target: topicProgress.topicId, set: row })

  return {
    topicId: input.topicId,
    score,
    previousScore: prev?.masteryScore ?? null,
    status: outcome.status,
    advances: outcome.advances,
    nextReviewAt: sched.nextReviewAt,
    reviewRound: sched.round,
  }
}

/**
 * 점수만 손으로 넣는 경로.
 *
 * 3단계에서 실제 채점이 붙은 뒤로 화면에서는 쓰지 않는다. 테스트가
 * 숙련도·복습 예약 기계를 LLM 없이 굴리는 데 쓴다 — applyResult 를 그대로
 * 타므로 상태 전이와 복습 예약이 실제 경로와 완전히 같다.
 */
export async function applyManualScore(
  db: Db, clock: Clock, topicId: string, score: number,
): Promise<ApplyResult> {
  const clamped = Math.round(Math.min(100, Math.max(0, score)))
  // 10점 눈금으로 포인트를 만든다. 비율만 맞으면 되므로 눈금은 임의다.
  const correct = Math.round(clamped / 10)

  return applyResult(db, clock, {
    topicId,
    correctPoints: correct,
    missedPoints: 10 - correct,
  })
}
