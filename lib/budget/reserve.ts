import { and, eq, lt, sql } from 'drizzle-orm'
import { budgetCounters, usageLedger } from '../db/schema'
import type { Db } from '../db/types'
import { kstMonth, kstToday, type Clock } from '../time'
import { dailyCallCap, monthlyCostCapMicros } from './caps'

export interface Reservation {
  periodKeys: string[]
}

export interface UsageEntry {
  route: string
  subject: string | null
  model: string
  promptTokens: number | null
  completionTokens: number | null
  costMicros: number
  ok: boolean
}

/** 일일 캡은 호출 수로, 월간 캡은 비용으로 건다. 월간 호출 수는 사실상 무제한. */
const MONTHLY_CALL_CAP = 100_000

/**
 * 원자적으로 한 칸을 예약한다. null 이면 호출자는 LLM 을 호출하지 않고 429 를 준다.
 *
 * 이것이 폭주 루프에 대한 방어선(③겹)이다. 세션이 살아있고 멱등성 캐시가
 * 미스여도 여기서 막힌다.
 *
 * 각 UPDATE 는 한 문장이다 — 읽고-판단하고-쓰기로 나누면 그 사이에 다른 요청이
 * 끼어들어 캡을 넘길 수 있다. WHERE 절에 조건을 넣으면 조건을 만족할 때만
 * 증가하고, 못 맞추면 0행이 돌아온다.
 *
 * 첫 키에서 통과하고 둘째 키에서 막히면 첫 키를 되돌린다.
 */
export async function reserve(db: Db, clock: Clock): Promise<Reservation | null> {
  const now = clock.now()
  const capMicros = monthlyCostCapMicros()

  const plan = [
    { key: `day:${kstToday(now)}`,   capCalls: dailyCallCap() },
    { key: `month:${kstMonth(now)}`, capCalls: MONTHLY_CALL_CAP },
  ]

  const taken: string[] = []

  for (const { key, capCalls } of plan) {
    await db.insert(budgetCounters)
      .values({ periodKey: key, capCalls, capMicros })
      .onConflictDoNothing()

    const updated = await db
      .update(budgetCounters)
      .set({ calls: sql`${budgetCounters.calls} + 1` })
      .where(and(
        eq(budgetCounters.periodKey, key),
        lt(budgetCounters.calls, budgetCounters.capCalls),
        lt(budgetCounters.costMicros, budgetCounters.capMicros),
      ))
      .returning({ calls: budgetCounters.calls })

    if (updated.length === 0) {
      if (taken.length > 0) await rollback(db, { periodKeys: taken })
      return null
    }

    taken.push(key)
  }

  return { periodKeys: taken }
}

/** LLM 호출이 실패했을 때 예약을 되돌린다. 캡을 헛되이 소모하지 않기 위함이다. */
export async function rollback(db: Db, reservation: Reservation): Promise<void> {
  for (const key of reservation.periodKeys) {
    await db
      .update(budgetCounters)
      .set({ calls: sql`GREATEST(${budgetCounters.calls} - 1, 0)` })
      .where(eq(budgetCounters.periodKey, key))
  }
}

/**
 * 호출이 끝난 뒤 실제 토큰과 비용을 기록한다.
 * 실패한 호출도 남긴다 — 무슨 일이 있었는지 알아야 캡을 재조정할 수 있다.
 */
export async function recordUsage(db: Db, clock: Clock, entry: UsageEntry): Promise<void> {
  const now = clock.now()

  await db.insert(usageLedger).values({
    createdAt: now,
    route: entry.route,
    subject: entry.subject,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    costMicros: entry.costMicros,
    ok: entry.ok,
  })

  await db
    .update(budgetCounters)
    .set({ costMicros: sql`${budgetCounters.costMicros} + ${entry.costMicros}` })
    .where(eq(budgetCounters.periodKey, `month:${kstMonth(now)}`))
}
