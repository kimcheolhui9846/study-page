import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { completeDay } from '@/lib/study/complete'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

/** LLM 을 부르지 않는다. 예산도 쓰지 않는다. */
export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    { dayNo?: unknown; disputed?: unknown } | null

  const dayNo = Number(body?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  await completeDay(db, systemClock, subject as Subject, dayNo, body?.disputed === true)
  return new NextResponse(null, { status: 204 })
})
