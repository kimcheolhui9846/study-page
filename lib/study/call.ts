import type { Db } from '../db/types'
import type { Clock } from '../time'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import { LlmHttpError, LlmTruncatedError } from '../llm/client'
import { maxCostMicros } from '../llm/pricing'
import type { LlmClient, ReasoningEffort } from '../llm/types'
import type { StudyMode } from './modes'

export interface StudyDeps {
  db: Db
  clock: Clock
  llm: LlmClient
}

export type CallFailure = 'BUDGET_EXCEEDED' | 'GENERATION_FAILED' | 'INVALID_OUTPUT'

export type CallOutcome<T> = { ok: true; data: T } | { ok: false; code: CallFailure }

export type StudyRoute = 'study-start' | 'study-chat' | 'study-material' | 'study-feedback'

const TIMEOUT_MS = 60_000

/**
 * 자유학습의 유료 호출 1회. 모든 유료 행동이 여기를 지난다.
 *
 * ③ 예산 — reserve() 를 못 잡으면 부르지 않는다.
 * 재시도는 0회다. 형식이 틀렸다고 다시 부르면 그만큼 돈이 나간다.
 *
 * ★ 실패 정산은 「돈이 나갔는가」로 가른다:
 *
 *   | 실패                     | 예약   | 원장                         |
 *   |--------------------------|--------|------------------------------|
 *   | HTTP 오류 (서버가 거절)    | 롤백   | ok=false, 0원                |
 *   | 타임아웃·연결 끊김         | 유지   | ok=false, 상한 비용(보수적)   |
 *   | 잘림                     | 유지   | ok=false, 실제 사용량         |
 *   | 형식 오류                 | 유지   | ok=false, 실제 사용량         |
 *
 * 타임아웃을 0원으로 보면 안 된다 — 요청이 OpenAI 에 닿아 처리됐을 수 있다.
 * 모르는 비용은 크게 잡는다. 월 캡이 실제보다 빨리 닫히는 쪽이 반대보다 낫다.
 */
export async function paidCall<T>(deps: StudyDeps, i: {
  route: StudyRoute
  model: string
  reasoningEffort: ReasoningEffort
  maxTokens: number
  system: string
  user: string
  schemaName: string
  jsonSchema: object
  parse: (x: unknown) => { success: true; data: T } | { success: false }
  subject: StudyMode
  requestId: string
  sessionId: number | null
}): Promise<CallOutcome<T>> {
  const reservation = await reserve(deps.db, deps.clock)
  if (!reservation) return { ok: false, code: 'BUDGET_EXCEEDED' }

  const base = {
    route: i.route, subject: i.subject, model: i.model,
    requestId: i.requestId, studySessionId: i.sessionId,
  }

  let result
  try {
    result = await deps.llm.generate<unknown>({
      route: i.route, model: i.model, reasoningEffort: i.reasoningEffort,
      system: i.system, user: i.user, schemaName: i.schemaName, jsonSchema: i.jsonSchema,
      maxTokens: i.maxTokens, timeoutMs: TIMEOUT_MS,
    })
  } catch (e) {
    if (e instanceof LlmHttpError) {
      await rollback(deps.db, reservation)
      await recordUsage(deps.db, deps.clock, {
        ...base, promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
      })
    } else if (e instanceof LlmTruncatedError) {
      await recordUsage(deps.db, deps.clock, {
        ...base, promptTokens: e.promptTokens, completionTokens: e.completionTokens,
        costMicros: e.costMicros, ok: false,
      })
    } else {
      await recordUsage(deps.db, deps.clock, {
        ...base, promptTokens: null, completionTokens: null, ok: false,
        costMicros: maxCostMicros(i.model, i.system.length + i.user.length, i.maxTokens),
      })
    }
    return { ok: false, code: 'GENERATION_FAILED' }
  }

  const usage = {
    ...base,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
  }

  const parsed = i.parse(stripControl(result.data))
  if (!parsed.success) {
    // 응답을 받았으니 돈은 나갔다. 예약을 돌려주면 계속 틀리는 응답이 캡에 안 걸린다.
    await recordUsage(deps.db, deps.clock, { ...usage, ok: false })
    return { ok: false, code: 'INVALID_OUTPUT' }
  }

  await recordUsage(deps.db, deps.clock, { ...usage, ok: true })
  return { ok: true, data: parsed.data }
}

// ANSI 이스케이프(ESC [ … 글자)와 줄바꿈·탭을 뺀 C0 제어 문자·DEL.
// 2026-11-16 실호출에서 모델이 수식 안에 「ESC[0m」을 섞어 낸 적이 있다.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** 모델 응답의 모든 문자열에서 화면을 깨는 제어 문자를 지운다. 구조는 그대로 둔다. */
export function stripControl(x: unknown): unknown {
  if (typeof x === 'string') return x.replace(ANSI, '').replace(CONTROL, '')
  if (Array.isArray(x)) return x.map(stripControl)
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, stripControl(v)]))
  }
  return x
}
