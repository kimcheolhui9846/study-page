import { withSession } from '@/lib/session/guard'
import { studyDeps } from '@/lib/study/deps'
import { startSession } from '@/lib/study/engine'
import { invalid, readBody, text, toResponse } from '@/lib/study/http'
import { isStudyMode } from '@/lib/study/modes'
import { isRequestId } from '@/lib/study/requests'

/**
 * 자유학습 시작 — 모드 + 자유 입력. ← 돈 (terra 1회)
 *
 * 커리큘럼·오늘 계획을 보지 않는다. 등록되지 않은 주제도 시작한다.
 * 응답에는 세션 ID 만 — 화면은 /study/[id] 에서 서버가 다시 읽어 그린다.
 */
export const maxDuration = 90

export const POST = withSession(async (req) => {
  const body = await readBody(req)
  const request = text(body?.request, 4_000)
  if (!body || !isStudyMode(body.mode) || !request || !isRequestId(body.requestId)) return invalid()

  const r = await startSession(studyDeps(), { mode: body.mode, request, requestId: body.requestId })
  return toResponse(r, 201)
})
