import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { applyManualScore } from '@/lib/mastery/apply'
import { completePlanIfDone, recordItemResult } from '@/lib/plan/store'

/**
 * 점수를 받아 숙련도를 갱신한다. **LLM 을 부르지 않는다.**
 *
 * 2단계의 경로다. 3단계에서 GPT 채점이 붙으면 correct/missed 포인트가
 * 실제 근거로 채워지지만, applyResult 아래는 그대로다.
 */
export const POST = withSession(async (req) => {
  const body = (await req.json().catch(() => null)) as
    { planId?: unknown; topicId?: unknown; score?: unknown } | null

  const planId = Number(body?.planId)
  const score = Number(body?.score)
  const topicId = typeof body?.topicId === 'string' ? body.topicId : ''

  if (!Number.isInteger(planId) || planId < 1 || !topicId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return NextResponse.json({ error: 'INVALID_SCORE' }, { status: 400 })
  }

  let result
  try {
    result = await applyManualScore(db, systemClock, topicId, score)
  } catch {
    // 커리큘럼에 없는 Topic. 화면이 보낸 값이 낡았다는 뜻이다.
    return NextResponse.json({ error: 'UNKNOWN_TOPIC' }, { status: 404 })
  }

  await recordItemResult(db, planId, topicId, { attemptNo: 1, score: result.score })
  const completed = await completePlanIfDone(db, systemClock, planId)

  return NextResponse.json({ ...result, planCompleted: completed })
})
