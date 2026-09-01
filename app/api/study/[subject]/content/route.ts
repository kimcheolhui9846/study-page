import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { OpenAiLlmClient } from '@/lib/llm/client'
import { getOrCreateContent, type ContentOutcome } from '@/lib/study/content'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

// ★ 여기서부터 실제 호출이다. 4겹은 lib/study/content.ts 안에 있다.
const llm = new OpenAiLlmClient()

const STATUS_CODE: Record<Exclude<ContentOutcome['status'], 'ok'>, number> = {
  no_such_day: 404,
  already_studied_today: 409,
  cap_exceeded: 429,
}

export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  // Next 16 에서 params 는 Promise 다. URL 문자열을 자르지 않는다.
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const dayNo = Number((body as { dayNo?: unknown } | null)?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  const outcome = await getOrCreateContent(
    { db, clock: systemClock, llm }, subject as Subject, dayNo,
  )

  if (outcome.status === 'ok') return NextResponse.json(outcome.content)

  return NextResponse.json(
    { error: outcome.status.toUpperCase() },
    { status: STATUS_CODE[outcome.status] },
  )
})
