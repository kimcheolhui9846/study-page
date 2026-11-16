import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { budgetCounters, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { ScriptedLlmClient } from '../../lib/llm/fake'
import { LlmHttpError, LlmTransportError, LlmTruncatedError } from '../../lib/llm/client'
import { WORK_MODEL, maxCostMicros } from '../../lib/llm/pricing'
import { dailyCallCap } from '../../lib/budget/caps'
import { paidCall } from '../../lib/study/call'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-11-16T03:00:00Z')
const DAY = 'day:2026-11-16'

beforeEach(async () => { ({ db, close } = await createTestDb()); vi.stubEnv('APP_ENV', 'local') })
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const Out = z.object({ ok: z.literal(true) })

function call(llm: ScriptedLlmClient) {
  return paidCall({ db, clock, llm }, {
    route: 'study-material', model: WORK_MODEL, reasoningEffort: 'low', maxTokens: 12_000,
    system: 'S'.repeat(1000), user: 'U'.repeat(3000), schemaName: 'x', jsonSchema: {},
    parse: (x) => Out.safeParse(x), subject: 'math', requestId: 'req-1', sessionId: 5,
  })
}

async function dayCalls() {
  const rows = await db.select().from(budgetCounters)
  return rows.find((r) => r.periodKey === DAY)?.calls ?? 0
}

describe('paidCall — 정산 다섯 갈래', () => {
  it('성공 — 원장 ok, 요청 ID 와 세션이 남는다', async () => {
    const llm = new ScriptedLlmClient(() => ({ ok: true }))
    expect(await call(llm)).toEqual({ ok: true, data: { ok: true } })
    expect(llm.requests[0].model).toBe(WORK_MODEL)
    expect(llm.requests[0].timeoutMs).toBe(60_000)
    const [led] = await db.select().from(usageLedger)
    expect(led).toMatchObject({ ok: true, route: 'study-material', subject: 'math', requestId: 'req-1', studySessionId: 5, model: WORK_MODEL })
    expect(await dayCalls()).toBe(1)
  })

  it('★ 예산이 없으면 부르지 않는다', async () => {
    for (let i = 0; i < dailyCallCap(); i++) await call(new ScriptedLlmClient(() => ({ ok: true })))
    const llm = new ScriptedLlmClient(() => ({ ok: true }))
    expect(await call(llm)).toEqual({ ok: false, code: 'BUDGET_EXCEEDED' })
    expect(llm.calls).toBe(0)
  })

  it('HTTP 오류 — 예약을 되돌리고 0원으로 남긴다', async () => {
    const r = await call(new ScriptedLlmClient(() => new LlmHttpError(500)))
    expect(r).toEqual({ ok: false, code: 'GENERATION_FAILED' })
    expect(await dayCalls()).toBe(0)
    const [led] = await db.select().from(usageLedger)
    expect(led).toMatchObject({ ok: false, costMicros: 0 })
  })

  it('★ 타임아웃 — 예약을 유지하고 상한 비용으로 보수 기록한다', async () => {
    const r = await call(new ScriptedLlmClient(() => new LlmTransportError()))
    expect(r).toEqual({ ok: false, code: 'GENERATION_FAILED' })
    expect(await dayCalls()).toBe(1)
    const [led] = await db.select().from(usageLedger)
    expect(led.ok).toBe(false)
    expect(led.costMicros).toBe(maxCostMicros(WORK_MODEL, 4000, 12_000))
    const month = (await db.select().from(budgetCounters)).find((x) => x.periodKey.startsWith('month'))
    expect(month?.costMicros).toBe(led.costMicros)
  })

  it('잘림 — 예약 유지, 실제 사용량 기록', async () => {
    await call(new ScriptedLlmClient(() => new LlmTruncatedError(10, 20, 777)))
    expect(await dayCalls()).toBe(1)
    const [led] = await db.select().from(usageLedger)
    expect(led).toMatchObject({ ok: false, costMicros: 777, promptTokens: 10, completionTokens: 20 })
  })

  it('★ 형식이 틀리면 INVALID_OUTPUT — 예약 유지, 재호출 없음', async () => {
    const llm = new ScriptedLlmClient(() => ({ ok: 'nope' }))
    expect(await call(llm)).toEqual({ ok: false, code: 'INVALID_OUTPUT' })
    expect(llm.calls).toBe(1)
    expect(await dayCalls()).toBe(1)
    const [led] = await db.select().from(usageLedger)
    expect(led.ok).toBe(false)
    expect(led.costMicros).toBeGreaterThan(0)
  })
})
