import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { requestMore } from '@/lib/study/engine'
import { invalid, parseId, readBody, toResponse } from '@/lib/study/http'
import { isRequestId } from '@/lib/study/requests'

/**
 * 추가 문제·「더 쉽게」 버튼. ← 돈 (terra 1회)
 * 같은 지시라도 새 requestId 면 새 자료다 — 「다른 문제 만들어 줘」는 재전송이 아니다.
 */
export const maxDuration = 90

export const POST = withSession<{ id: string }>(async (req, _session, ctx) => {
  const sessionId = parseId((await ctx.params).id)
  const body = await readBody(req)
  if (!sessionId || !body || !isRequestId(body.requestId)) return invalid()

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  if (instruction.length > 1_000) return invalid()

  const r = await requestMore(studyDeps(), { sessionId, instruction, requestId: body.requestId })
  return toResponse(r)
})
