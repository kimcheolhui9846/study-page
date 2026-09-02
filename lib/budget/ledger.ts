import { desc } from 'drizzle-orm'
import { planItems, usageLedger } from '../db/schema'
import type { Db } from '../db/types'
import { kstMonth, kstToday, type Clock } from '../time'
import { loadMaterialKeys, materialKey } from '../llm/ensure'
import { loadUsage } from './usage'
import {
  burnOf, byDay, byRoute, reuseOf,
  type Burn, type DayCost, type LedgerRow, type Reuse, type RouteCost,
} from './report'

/**
 * 비용 원장 화면이 필요한 것을 한 번에 읽는다.
 *
 * 계산은 전부 `report.ts` 의 순수 함수가 한다. 여기는 DB 에서 값을 꺼내
 * 넘기기만 한다 — `lib/progress/load.ts` 와 같은 구조다.
 */

/** 자료를 만드는 경로. 여기 든 돈만 재사용 절감의 분자가 된다. */
const GENERATION_ROUTES = new Set(['content', 'review'])

const RECENT_LIMIT = 20

export interface UsageReport {
  today: string
  month: string
  /** 오늘 몇 번 불렀나 */
  dailyCalls: number
  dailyCap: number
  burn: Burn
  routes: RouteCost[]
  days: DayCost[]
  reuse: Reuse
  recent: LedgerRow[]
  /** 시작부터 지금까지 */
  totalCalls: number
  totalCostMicros: number
  /** 돈은 나갔는데 결과가 없는 호출 */
  failedCalls: number
}

export async function loadUsageReport(db: Db, clock: Clock): Promise<UsageReport> {
  const now = clock.now()
  const today = kstToday(now)

  const usage = await loadUsage(db, clock)

  /*
   * 원장을 통째로 읽는다.
   *
   * 하루 호출이 캡으로 20회에 묶여 있으므로 1년을 써도 7천 행 남짓이다.
   * 페이지네이션을 만들 만한 크기가 아니고, 합계를 SQL 로 나눠 내면
   * 같은 정의가 두 곳에 생긴다 — 그건 어긋날 자리다.
   */
  const rows: LedgerRow[] = await db
    .select({
      createdAt: usageLedger.createdAt,
      route: usageLedger.route,
      subject: usageLedger.subject,
      model: usageLedger.model,
      promptTokens: usageLedger.promptTokens,
      completionTokens: usageLedger.completionTokens,
      costMicros: usageLedger.costMicros,
      ok: usageLedger.ok,
    })
    .from(usageLedger)
    .orderBy(desc(usageLedger.id))

  const items = await db
    .select({
      topicId: planItems.topicId,
      kind: planItems.kind,
      round: planItems.round,
    })
    .from(planItems)

  const generationCost = rows
    .filter((r) => GENERATION_ROUTES.has(r.route))
    .reduce((n, r) => n + (r.costMicros ?? 0), 0)

  return {
    today,
    month: kstMonth(now),
    dailyCalls: usage.dailyCalls,
    dailyCap: usage.dailyCap,
    burn: burnOf({
      // 월 카운터가 캡을 판정하는 값이다. 원장을 다시 더하지 않는다 —
      // 캡에 걸리는 근거와 화면이 보여주는 금액은 같은 수여야 한다.
      spentMicros: usage.monthlyCostMicros,
      capMicros: usage.monthlyCapMicros,
      today,
    }),
    routes: byRoute(rows),
    days: byDay(rows),
    reuse: reuseOf({
      usedKeys: items.map((i) => materialKey(i.topicId, i.kind, i.round)),
      generated: await loadMaterialKeys(db),
      generationCostMicros: generationCost,
    }),
    recent: rows.slice(0, RECENT_LIMIT),
    totalCalls: rows.length,
    totalCostMicros: rows.reduce((n, r) => n + (r.costMicros ?? 0), 0),
    failedCalls: rows.filter((r) => !r.ok).length,
  }
}
