import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { OpenAiLlmClient } from '@/lib/llm/client'
import { gradeAnswers, type GradeOutcome } from '@/lib/study/grade'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

const llm = new OpenAiLlmClient()

const STATUS_CODE: Record<Exclude<GradeOutcome['status'], 'ok'>, number> = {
  no_such_day: 404,
  empty_answers: 400,
  attempt_cap: 429,
  cap_exceeded: 429,
}

export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    { dayNo?: unknown; answers?: unknown } | null

  const dayNo = Number(body?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  const raw = body?.answers
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_ANSWERS' }, { status: 400 })
  }

  // 값은 문자열만 통과시킨다. 객체가 섞이면 프롬프트에 [object Object] 가
  // 들어가고, 그걸 채점하느라 돈이 나간다.
  const answers = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>

  const outcome = await gradeAnswers(
    { db, clock: systemClock, llm }, subject as Subject, dayNo, answers,
  )

  if (outcome.status === 'ok') {
    return NextResponse.json({ attemptNo: outcome.attemptNo, feedback: outcome.feedback })
  }
  return NextResponse.json(
    { error: outcome.status.toUpperCase() },
    { status: STATUS_CODE[outcome.status] },
  )
})
