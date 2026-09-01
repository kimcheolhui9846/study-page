import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { withSession } from '@/lib/session/guard'
import { readHint } from '@/lib/study/hint'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

/** LLM 을 부르지 않고 예산도 쓰지 않는다. 비용 0원이다. */
export const GET = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const url = new URL(req.url)
  const dayNo = Number(url.searchParams.get('dayNo'))
  const questionId = url.searchParams.get('questionId') ?? ''
  if (!Number.isInteger(dayNo) || dayNo < 1 || !questionId) {
    return NextResponse.json({ error: 'INVALID_QUERY' }, { status: 400 })
  }

  const hint = await readHint(db, subject as Subject, dayNo, questionId)
  if (hint === null) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ hint })
})
