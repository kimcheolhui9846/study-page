import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { revealHint } from '@/lib/study/engine'
import { invalid, parseId, toResponse } from '@/lib/study/http'

/** 저장된 단계 힌트를 하나 연다. ← 0원 (AI 호출 없음) */
export const POST = withSession<{ id: string }>(async (_req, _session, ctx) => {
  const problemId = parseId((await ctx.params).id)
  if (!problemId) return invalid()
  return toResponse(await revealHint(studyDeps(), { problemId }))
})
