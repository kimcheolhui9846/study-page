import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { reserve, rollback, recordUsage } from '../../lib/budget/reserve'
import { dailyCallCap } from '../../lib/budget/caps'
import { budgetCounters, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

const DAY_KEY = 'day:2026-09-01'
const MONTH_KEY = 'month:2026-09'

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z') // KST 2026-09-01 10:00
  vi.stubEnv('APP_ENV', 'local')             // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

async function counter(key: string) {
  const [row] = await db.select().from(budgetCounters).where(eq(budgetCounters.periodKey, key))
  return row
}

describe('reserve', () => {
  it('캡 이내면 예약을 준다', async () => {
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('캡을 넘으면 null 을 준다 — 호출자는 LLM 을 부르지 않는다', async () => {
    for (let i = 0; i < dailyCallCap(); i++) {
      expect(await reserve(db, clock)).not.toBeNull()
    }
    expect(await reserve(db, clock)).toBeNull()
  })

  it('★ 동시 요청 10개가 캡 3에서 정확히 3번만 통과한다', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(db, clock)))
    expect(results.filter((r) => r !== null)).toHaveLength(dailyCallCap())

    // 카운터도 정확히 캡에서 멈춰야 한다. 초과 증가가 있으면 레이스가 있는 것이다.
    expect((await counter(DAY_KEY)).calls).toBe(dailyCallCap())
  })

  it('일일과 월간 두 카운터를 함께 올린다', async () => {
    const r = await reserve(db, clock)
    expect(r!.periodKeys).toEqual([DAY_KEY, MONTH_KEY])
    expect((await counter(DAY_KEY)).calls).toBe(1)
    expect((await counter(MONTH_KEY)).calls).toBe(1)
  })

  it('날짜가 바뀌면 일일 카운터가 리셋된다', async () => {
    for (let i = 0; i < dailyCallCap(); i++) await reserve(db, clock)
    expect(await reserve(db, clock)).toBeNull()

    clock.advance(24 * 60 * 60 * 1000)
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('★ KST 자정 경계에서 리셋된다 — UTC 가 아니라', async () => {
    const beforeMidnight = fixedClock('2026-09-01T14:59:00Z') // KST 23:59
    for (let i = 0; i < dailyCallCap(); i++) await reserve(db, beforeMidnight)
    expect(await reserve(db, beforeMidnight)).toBeNull()

    const afterMidnight = fixedClock('2026-09-01T15:01:00Z') // KST 다음날 00:01
    expect(await reserve(db, afterMidnight)).not.toBeNull()
  })

  it('월 비용 상한을 넘기면 일일 캡이 남아 있어도 막는다', async () => {
    await reserve(db, clock)
    // 월 비용을 상한까지 채운다
    await db.update(budgetCounters)
      .set({ costMicros: 500_000 })
      .where(eq(budgetCounters.periodKey, MONTH_KEY))

    expect(await reserve(db, clock)).toBeNull()
  })

  it('월간 캡에 걸리면 일일 예약을 되돌린다 — 캡을 헛되이 소모하지 않는다', async () => {
    await db.insert(budgetCounters).values({
      periodKey: MONTH_KEY, calls: 0, costMicros: 500_000,
      capCalls: 100_000, capMicros: 500_000,
    })

    expect(await reserve(db, clock)).toBeNull()
    expect((await counter(DAY_KEY)).calls).toBe(0) // 일일이 올라간 채로 남으면 안 된다
  })
})

describe('rollback', () => {
  it('호출 실패 시 예약을 되돌린다', async () => {
    const r = await reserve(db, clock)
    await rollback(db, r!)
    expect((await counter(DAY_KEY)).calls).toBe(0)
    expect((await counter(MONTH_KEY)).calls).toBe(0)
  })

  it('롤백하면 다시 예약할 수 있다', async () => {
    for (let i = 0; i < dailyCallCap(); i++) await reserve(db, clock)
    expect(await reserve(db, clock)).toBeNull()

    await rollback(db, { periodKeys: [DAY_KEY, MONTH_KEY] })
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('0 밑으로 내려가지 않는다', async () => {
    await reserve(db, clock)
    const r = { periodKeys: [DAY_KEY, MONTH_KEY] }
    await rollback(db, r)
    await rollback(db, r)
    expect((await counter(DAY_KEY)).calls).toBe(0)
  })
})

describe('recordUsage', () => {
  it('원장에 남기고 월간 비용 카운터를 올린다', async () => {
    await reserve(db, clock)
    await recordUsage(db, clock, {
      route: 'content', subject: 'cs', model: 'fake',
      promptTokens: 800, completionTokens: 1200, costMicros: 840, ok: true,
    })

    const ledger = await db.select().from(usageLedger)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].costMicros).toBe(840)
    expect(ledger[0].ok).toBe(true)
    expect((await counter(MONTH_KEY)).costMicros).toBe(840)
  })

  it('실패한 호출도 원장에 남긴다 — 무슨 일이 있었는지 알아야 한다', async () => {
    await reserve(db, clock)
    await recordUsage(db, clock, {
      route: 'content', subject: 'cs', model: 'fake',
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })

    const ledger = await db.select().from(usageLedger)
    expect(ledger[0].ok).toBe(false)
  })

  it('비용이 누적된다', async () => {
    await reserve(db, clock)
    const entry = {
      route: 'content', subject: 'cs', model: 'fake',
      promptTokens: 100, completionTokens: 100, costMicros: 500, ok: true,
    }
    await recordUsage(db, clock, entry)
    await recordUsage(db, clock, entry)
    expect((await counter(MONTH_KEY)).costMicros).toBe(1000)
  })
})

describe('캡 값', () => {
  it('production 은 20, 그 외는 3', () => {
    vi.stubEnv('APP_ENV', 'production')
    expect(dailyCallCap()).toBe(20)
    vi.stubEnv('APP_ENV', 'preview')
    expect(dailyCallCap()).toBe(3)
    vi.stubEnv('APP_ENV', 'local')
    expect(dailyCallCap()).toBe(3)
  })

  it('APP_ENV 가 없으면 낮은 캡을 쓴다 — 안전한 기본값', () => {
    vi.stubEnv('APP_ENV', '')
    expect(dailyCallCap()).toBe(3)
  })
})

describe('캡은 행이 아니라 환경에서 온다', () => {
  /*
   * 배포 첫날 실제로 겪은 일이다. 로컬에서 만들어진 카운터 행이 로컬 캡
   * (3회 / $0.50)을 들고 있어서, production 으로 배포한 뒤에도 그 기간
   * 내내 로컬 캡에 묶였다.
   */
  it('★ 행에 굳은 낮은 캡이 환경 캡을 이기지 않는다', async () => {
    for (let i = 0; i < 3; i++) expect(await reserve(db, clock)).not.toBeNull()
    expect(await reserve(db, clock)).toBeNull()   // 로컬 캡 3 에서 막힌다

    vi.stubEnv('APP_ENV', 'production')           // 같은 행, 캡만 20 으로
    expect(await reserve(db, clock)).not.toBeNull()
    expect((await counter(DAY_KEY)).calls).toBe(4)
  })

  it('★ 환경 캡이 낮아지면 즉시 막힌다 — 완화 쪽으로만 움직이지 않는다', async () => {
    vi.stubEnv('APP_ENV', 'production')
    for (let i = 0; i < 4; i++) expect(await reserve(db, clock)).not.toBeNull()

    vi.stubEnv('APP_ENV', 'local')                // 캡 3 < 이미 쓴 4
    expect(await reserve(db, clock)).toBeNull()
  })

  it('행의 cap 컬럼은 마지막으로 예약한 환경을 남긴다', async () => {
    await reserve(db, clock)
    expect((await counter(DAY_KEY)).capCalls).toBe(3)

    vi.stubEnv('APP_ENV', 'production')
    await reserve(db, clock)
    expect((await counter(DAY_KEY)).capCalls).toBe(20)
  })

  it('★ 월 비용 캡도 환경에서 온다', async () => {
    await reserve(db, clock)
    await recordUsage(db, clock, {
      route: 'content', subject: 'cs', model: 'gpt-4o-mini',
      promptTokens: 1, completionTokens: 1, costMicros: 600_000, ok: true,
    })
    expect(await reserve(db, clock)).toBeNull()   // 로컬 캡 $0.50 초과

    vi.stubEnv('APP_ENV', 'production')           // $3.00
    expect(await reserve(db, clock)).not.toBeNull()
  })
})

