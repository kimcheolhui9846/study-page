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

  /*
   * ★ 캡은 환경에서 읽는다. 행에 저장된 cap 컬럼을 읽지 않는다.
   *
   * `reserve()` 가 환경 캡으로 판정하므로 화면도 같은 곳을 봐야 한다.
   * 행의 값을 보여주면 마지막으로 예약한 환경의 캡이 나와서, 실제로
   * 막히는 지점과 화면이 어긋난다.
   */
  return {
    dailyCalls: day?.calls ?? 0,
    dailyCap: dailyCallCap(),
    monthlyCostMicros: month?.costMicros ?? 0,
    monthlyCapMicros: monthlyCostCapMicros(),
  }
}
