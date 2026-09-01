import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { kstToday, systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { llmDeps } from '@/lib/llm/deps'
import { ensureMaterial, type EnsureFailure } from '@/lib/llm/ensure'
import { loadProgressMap, markStudying, readPlan } from '@/lib/plan/store'

/**
 * 오늘 계획에 있는 Topic 하나의 학습 자료를 확보한다.
 *
 * ★ 계획에 없는 Topic 은 만들지 않는다. 계획이 곧 예산이므로
 * (`daily_plans.estimated_calls`), 계획 밖에서 생성이 일어나면 하루의
 * 호출 수가 미리 계산한 값을 넘는다.
 *
 * 자료 자체는 응답에 담지 않는다. 화면이 서버에서 다시 읽어 그린다 —
 * 루브릭과 힌트를 클라이언트로 내보내지 않기 위해서다.
 */

const STATUS: Record<EnsureFailure, number> = {
  BUDGET_EXCEEDED: 429,
  GENERATION_FAILED: 502,
  STORED_INVALID: 409,
  UNKNOWN_TOPIC: 404,
}

export const POST = withSession(async (req) => {
  const body = (await req.json().catch(() => null)) as { topicId?: unknown } | null
  const topicId = typeof body?.topicId === 'string' ? body.topicId : ''
  if (!topicId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  const plan = await readPlan(db, kstToday(systemClock.now()))
  const item = plan?.items.find((i) => i.topicId === topicId)
  if (!plan || !item) {
    return NextResponse.json({ error: 'NOT_IN_TODAYS_PLAN' }, { status: 404 })
  }

  const result = await ensureMaterial(
    llmDeps(),
    { topicId, kind: item.kind as 'new' | 'review' | 'remediation', round: item.round, minutes: item.minutes },
    await loadProgressMap(db),
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: result.message },
      { status: STATUS[result.code] },
    )
  }

  await markStudying(db, plan.id, topicId)
  return NextResponse.json({ generated: result.generated })
})
