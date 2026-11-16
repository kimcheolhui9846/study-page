import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { submitAnswer } from '@/lib/study/engine'
import { invalid, parseId, readBody, text, toResponse } from '@/lib/study/http'
import { isRequestId } from '@/lib/study/requests'

/**
 * 답안·코드 제출 → 피드백. ← 돈 (terra 1회)
 * 코드를 실행하지 않는다. 결과는 「AI 코드 검토」다 (lib/study/runner.ts).
 */
export const maxDuration = 90

export const POST = withSession<{ id: string }>(async (req, _session, ctx) => {
  const sessionId = parseId((await ctx.params).id)
  const body = await readBody(req)
  const answer = text(body?.answer, 20_000)
  if (!sessionId || !body || !answer || !isRequestId(body.requestId)) return invalid()

  const problemId = typeof body.problemId === 'number' && Number.isSafeInteger(body.problemId) && body.problemId > 0
    ? body.problemId
    : null
  const feedbackMode = body.feedbackMode === 'full' || body.feedbackMode === 'errors-only'
    ? body.feedbackMode
    : null
  const language = body.language == null ? null : text(body.language, 20)
  if (!problemId || !feedbackMode || (body.language != null && !language)) return invalid()

  const r = await submitAnswer(studyDeps(), {
    sessionId, problemId, answer, language, feedbackMode, requestId: body.requestId,
  })
  return toResponse(r)
})
