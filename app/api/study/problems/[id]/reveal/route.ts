import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { revealSolutionFor } from '@/lib/study/engine'
import { invalid, parseId, toResponse } from '@/lib/study/http'

/**
 * 저장된 해설을 연다. ← 0원
 * 학습자가 명시적으로 누른 경우에만 온다. 연 뒤에는 화면 데이터에 해설이 들어간다.
 */
export const POST = withSession<{ id: string }>(async (_req, _session, ctx) => {
  const problemId = parseId((await ctx.params).id)
  if (!problemId) return invalid()
  return toResponse(await revealSolutionFor(studyDeps(), { problemId }))
})
