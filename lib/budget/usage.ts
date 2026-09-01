import { eq } from 'drizzle-orm'
import { budgetCounters } from '../db/schema'
import type { Db } from '../db/types'
import { kstMonth, kstToday, type Clock } from '../time'
import { dailyCallCap, monthlyCostCapMicros } from './caps'

/**
 * 예산 계기판. 화면 하단과 계획 엔진이 함께 읽는다.
 *
 * 카운터 행은 첫 예약 때 만들어진다. 아직 없으면 0 이다 —
 * 없는 것과 0 회 쓴 것은 사용자에게 같은 뜻이다.
 */
export interface UsageSnapshot {
  dailyCalls: number
  dailyCap: number
  monthlyCostMicros: number
  monthlyCapMicros: number
}

export async function loadUsage(db: Db, clock: Clock): Promise<UsageSnapshot> {
  const now = clock.now()

  const [day] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, `day:${kstToday(now)}`))
  const [month] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, `month:${kstMonth(now)}`))

  return {
    dailyCalls: day?.calls ?? 0,
    dailyCap: day?.capCalls ?? dailyCallCap(),
    monthlyCostMicros: month?.costMicros ?? 0,
    monthlyCapMicros: month?.capMicros ?? monthlyCostCapMicros(),
  }
}
