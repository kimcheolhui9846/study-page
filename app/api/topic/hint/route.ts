import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { kstToday, systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { loadGraph } from '@/lib/curriculum/load'
import { loadStoredMaterial } from '@/lib/llm/ensure'
import { hintFor } from '@/lib/llm/schemas'
import { readPlan } from '@/lib/plan/store'

/**
 * 힌트를 하나 꺼낸다. **LLM 을 부르지 않는다** — 이미 DB 에 있다.
 *
 * 힌트를 페이지에 함께 내려보내지 않는 이유가 이 라우트다. 소스 보기로
 * 보이면 힌트가 아니다.
 */
export const GET = withSession(async (req) => {
  const url = new URL(req.url)
  const topicId = url.searchParams.get('topicId') ?? ''
  const questionId = url.searchParams.get('questionId') ?? ''
  if (!topicId || !questionId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

  const graph = loadGraph()
  const topic = graph.topics.get(topicId)
  const plan = await readPlan(db, kstToday(systemClock.now()))
  const item = plan?.items.find((i) => i.topicId === topicId)
  if (!topic || !item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const material = await loadStoredMaterial(db, topic, {
    topicId, kind: item.kind as 'new' | 'review' | 'remediation',
    round: item.round, minutes: item.minutes,
  })
  if (!material || material === 'invalid') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const hint = hintFor(material, questionId)
  if (hint === null) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ hint })
})
