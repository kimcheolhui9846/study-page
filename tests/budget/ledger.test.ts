import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import {
  budgetCounters, dailyPlans, planItems, reviewItems, topicContents, usageLedger,
} from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadUsageReport } from '../../lib/budget/ledger'

const TOPIC = 'cs.prog.variables-types'
const OTHER = 'english.grammar.sentence-structure'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-09-02T10:00:00+09:00')

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function seedLedger() {
  await db.insert(usageLedger).values([
    {
      createdAt: new Date('2026-09-01T02:00:00Z'), route: 'content', subject: 'cs',
      model: 'gpt-4o-mini', promptTokens: 900, completionTokens: 400, costMicros: 559, ok: true,
    },
    {
      createdAt: new Date('2026-09-01T02:10:00Z'), route: 'content', subject: 'english',
      model: 'gpt-4o-mini', promptTokens: 950, completionTokens: 430, costMicros: 600, ok: true,
    },
    {
      createdAt: new Date('2026-09-02T02:00:00Z'), route: 'grade', subject: null,
      model: 'gpt-4o-mini', promptTokens: 1200, completionTokens: 300, costMicros: 608, ok: true,
    },
    {
      createdAt: new Date('2026-09-02T02:05:00Z'), route: 'grade', subject: null,
      model: 'gpt-4o-mini', promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    },
  ])
}

describe('비용 원장', () => {
  it('아무것도 안 썼어도 화면이 그려진다', async () => {
    const r = await loadUsageReport(db, clock)

    expect(r.totalCalls).toBe(0)
    expect(r.totalCostMicros).toBe(0)
    expect(r.routes).toEqual([])
    expect(r.days).toEqual([])
    expect(r.reuse.materials).toBe(0)
    expect(r.burn.percent).toBe(0)
  })

  it('총액과 실패 수를 낸다', async () => {
    await seedLedger()
    const r = await loadUsageReport(db, clock)

    expect(r.totalCalls).toBe(4)
    expect(r.totalCostMicros).toBe(1767)
    expect(r.failedCalls).toBe(1)
  })

  it('경로별로 나눈다 — 비싼 것부터', async () => {
    await seedLedger()
    const r = await loadUsageReport(db, clock)

    expect(r.routes.map((x) => x.route)).toEqual(['content', 'grade'])
    expect(r.routes[0]!.costMicros).toBe(1159)
    expect(r.routes[1]!.failed).toBe(1)
  })

  it('날짜별로 묶는다', async () => {
    await seedLedger()
    const r = await loadUsageReport(db, clock)

    expect(r.days.map((d) => d.date)).toEqual(['2026-09-02', '2026-09-01'])
    expect(r.days[1]!.costMicros).toBe(1159)
  })

  it('최근 호출은 새 것부터 온다', async () => {
    await seedLedger()
    const r = await loadUsageReport(db, clock)

    expect(r.recent[0]!.ok).toBe(false)
    expect(r.recent[0]!.route).toBe('grade')
  })

  it('★ 이번 달 금액은 원장이 아니라 월 카운터에서 온다', async () => {
    /*
     * 캡을 판정하는 값과 화면이 보여주는 값이 같아야 한다. 원장을 다시
     * 더해 보여주면, 롤백된 예약이나 기록 누락이 생겼을 때 화면은
     * 안전하다고 말하는데 실제로는 막히는 상태가 된다.
     */
    await seedLedger()
    await db.insert(budgetCounters).values({
      periodKey: 'month:2026-09',
      calls: 4, costMicros: 999_999, capCalls: 100_000, capMicros: 3_000_000,
    })

    const r = await loadUsageReport(db, clock)

    expect(r.burn.spentMicros).toBe(999_999)
    expect(r.burn.capMicros).toBe(3_000_000)
    expect(r.totalCostMicros).toBe(1767) // 원장 합계는 따로 남는다
  })

  it('오늘 호출 수는 일 카운터에서 온다', async () => {
    await db.insert(budgetCounters).values({
      periodKey: 'day:2026-09-02',
      calls: 2, costMicros: 0, capCalls: 3, capMicros: 500_000,
    })

    const r = await loadUsageReport(db, clock)
    expect(r.dailyCalls).toBe(2)
    expect(r.dailyCap).toBe(3)
  })
})

describe('재사용 절감', () => {
  async function seedPlans() {
    const [p1] = await db.insert(dailyPlans).values({
      dayNumber: 1, studyDate: '2026-09-01', estimatedCalls: 2, estimatedMinutes: 40,
    }).returning({ id: dailyPlans.id })
    const [p2] = await db.insert(dailyPlans).values({
      dayNumber: 2, studyDate: '2026-09-02', estimatedCalls: 1, estimatedMinutes: 40,
    }).returning({ id: dailyPlans.id })

    await db.insert(planItems).values([
      { planId: p1!.id, topicId: TOPIC, kind: 'new', round: null, minutes: 20, priority: 10 },
      { planId: p1!.id, topicId: OTHER, kind: 'new', round: null, minutes: 20, priority: 9 },
      // 같은 Topic 을 다시 배운다 — 자료를 새로 만들지 않는다
      { planId: p2!.id, topicId: TOPIC, kind: 'review', round: null, minutes: 20, priority: 8 },
    ])
  }

  it('★ 다시 쓴 만큼을 아낀 것으로 센다', async () => {
    await seedLedger()
    await seedPlans()
    await db.insert(topicContents).values([
      { topicId: TOPIC, content: {}, model: 'gpt-4o-mini' },
      { topicId: OTHER, content: {}, model: 'gpt-4o-mini' },
    ])

    const r = await loadUsageReport(db, clock)

    expect(r.reuse.materials).toBe(2)
    expect(r.reuse.uses).toBe(3)
    expect(r.reuse.reuses).toBe(1)
    // 생성 경로(content) 총액 1159 을 자료 2개로 나눈 평균 × 1회
    expect(r.reuse.savedMicros).toBe(580)
  })

  it('★ 복습은 회차마다 다른 자료다 — 같은 Topic 이어도 재사용이 아니다', async () => {
    const [plan] = await db.insert(dailyPlans).values({
      dayNumber: 1, studyDate: '2026-09-02', estimatedCalls: 1, estimatedMinutes: 20,
    }).returning({ id: dailyPlans.id })
    await db.insert(planItems).values([
      { planId: plan!.id, topicId: TOPIC, kind: 'review', round: 1, minutes: 20, priority: 10 },
    ])
    await db.insert(reviewItems).values({ topicId: TOPIC, round: 1, content: {} })

    const r = await loadUsageReport(db, clock)

    expect(r.reuse.materials).toBe(1)
    expect(r.reuse.reuses).toBe(0)
  })

  it('자료가 아직 없는 계획 항목은 세지 않는다', async () => {
    await seedPlans() // 자료를 하나도 안 만든 상태
    const r = await loadUsageReport(db, clock)

    expect(r.reuse.uses).toBe(0)
    expect(r.reuse.savedMicros).toBe(0)
  })
})
