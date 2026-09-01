import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { kstToday, systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { readPlan, saveAnswers } from '@/lib/plan/store'

/**
 * 답안을 저장한다. **LLM 을 부르지 않는다.**
 *
 * 채점은 계획 전체를 한 번에 부르므로(호출 1회), 답을 쓰는 것과 채점받는
 * 것이 여기서 갈라진다. 이 라우트는 몇 번을 눌러도 돈이 들지 않는다.
 */

const MAX_ANSWER_CHARS = 4_000

export const POST = withSession(async (req) => {
  const body = (await req.json().catch(() => null)) as
    { topicId?: unknown; answers?: unknown } | null

  const topicId = typeof body?.topicId === 'string' ? body.topicId : ''
  const raw = body?.answers

  if (!topicId || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

  // 문자열만 받고 길이를 자른다. 채점 프롬프트에 그대로 들어가므로
  // 여기서 막지 않으면 입력 토큰이 답안 하나로 폭발할 수 있다.
  const answers: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue
    answers[k] = v.slice(0, MAX_ANSWER_CHARS)
  }

  const plan = await readPlan(db, kstToday(systemClock.now()))
  const item = plan?.items.find((i) => i.topicId === topicId)
  if (!plan || !item) {
    return NextResponse.json({ error: 'NOT_IN_TODAYS_PLAN' }, { status: 404 })
  }
  if (item.status !== 'studying') {
    // 아직 자료를 안 만들었거나(pending) 이미 채점이 끝났다(done).
    return NextResponse.json({ error: 'NOT_STUDYING' }, { status: 409 })
  }

  await saveAnswers(db, plan.id, topicId, answers)
  return NextResponse.json({ saved: true })
})
