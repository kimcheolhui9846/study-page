import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { sendMessage } from '@/lib/study/engine'
import { invalid, parseId, readBody, text, toResponse } from '@/lib/study/http'
import { isRequestId } from '@/lib/study/requests'

/**
 * 학습 중 메시지. ← 돈 (luna 1회, 자료 요청이면 terra 1회 더)
 * 두 호출이 이어질 수 있어 시간 상한을 넉넉히 둔다 (호출당 타임아웃 60초).
 */
export const maxDuration = 150

export const POST = withSession<{ id: string }>(async (req, _session, ctx) => {
  const sessionId = parseId((await ctx.params).id)
  const body = await readBody(req)
  const message = text(body?.text, 4_000)
  if (!sessionId || !body || !message || !isRequestId(body.requestId)) return invalid()

  const problemId = typeof body.problemId === 'number' && Number.isSafeInteger(body.problemId)
    ? body.problemId
    : undefined

  const r = await sendMessage(studyDeps(), { sessionId, text: message, problemId, requestId: body.requestId })
  return toResponse(r)
})
