import type { EngineError, EngineResult } from './engine'

/** 엔진 결과를 HTTP 로. 화면(lib/study/client-api.ts)이 이 상태 코드로 상태를 가른다 */
const STATUS: Record<EngineError, number> = {
  BUDGET_EXCEEDED: 429,
  GENERATION_FAILED: 502,
  INVALID_OUTPUT: 502,
  IN_PROGRESS: 409,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  REQUEST_MISMATCH: 409,
  NO_MORE_HINTS: 409,
  ATTEMPT_LIMIT: 409,
}

export function toResponse<T extends object>(r: EngineResult<T>, okStatus = 200): Response {
  if (!r.ok) return Response.json({ error: r.code, message: r.message }, { status: STATUS[r.code] })
  return Response.json({ ...r.value, replayed: r.replayed }, { status: okStatus })
}

export function invalid(message = '입력이 올바르지 않다.'): Response {
  return Response.json({ error: 'INVALID_INPUT', message }, { status: 400 })
}

/** 경로의 숫자 ID. 양의 안전한 정수만 */
export function parseId(s: string): number | null {
  if (!/^\d{1,15}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

/** 길이 제한이 있는 문자열. 앞뒤 공백을 걷어낸 뒤 비면 null */
export function text(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const t = x.trim()
  return t.length > 0 && t.length <= max ? t : null
}
