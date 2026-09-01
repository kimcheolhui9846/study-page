import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { kstToday, systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { llmDeps } from '@/lib/llm/deps'
import { gradePlan, type GradeFailure } from '@/lib/llm/grade'
import { readPlan } from '@/lib/plan/store'

/**
 * 오늘 계획을 통째로 채점한다. **호출 1회다.**
 *
 * 항목마다 부르지 않는 것이 이 라우트의 존재 이유다 — 그래서 몸통에
 * topicId 를 받지 않는다. 받으면 항목별 채점을 부를 수 있게 되고,
 * 하루 호출 수가 계획이 예고한 값을 넘는다.
 */

const STATUS: Record<GradeFailure, number> = {
  NO_ANSWERS: 409,
  BUDGET_EXCEEDED: 429,
  GRADING_FAILED: 502,
  MATERIAL_MISSING: 409,
}

export const POST = withSession(async () => {
  const plan = await readPlan(db, kstToday(systemClock.now()))
  if (!plan) return NextResponse.json({ error: 'NO_PLAN' }, { status: 404 })

  const result = await gradePlan(llmDeps(), plan)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: result.message },
      { status: STATUS[result.code] },
    )
  }

  return NextResponse.json({
    graded: result.items.length,
    planCompleted: result.planCompleted,
  })
})
