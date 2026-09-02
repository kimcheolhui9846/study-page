import { kstToday } from '../time'

/**
 * 비용 원장을 읽을 수 있는 형태로 바꾸는 계산들.
 *
 * ★ DB 도 화면도 모른다. 값을 받아 값을 낸다 — 그래서 전부 테스트된다.
 * 돈에 관한 숫자이므로 화면이 직접 계산하는 것을 하나도 두지 않는다.
 */

export interface LedgerRow {
  createdAt: Date
  route: string
  subject: string | null
  model: string
  promptTokens: number | null
  completionTokens: number | null
  costMicros: number | null
  ok: boolean
}

// ── 금액 표기 ───────────────────────────────────

/**
 * 마이크로달러를 사람이 읽는 금액으로.
 *
 * ★ 자릿수를 금액에 맞춘다. 이 앱의 한 번 호출은 $0.0006 수준이라
 * 소수 둘째 자리로 자르면 전부 $0.00 이 되어 화면이 아무 말도 못 한다.
 * 반대로 월 합계에 여섯 자리를 쓰면 읽히지 않는다.
 */
export function formatUsd(micros: number): string {
  const usd = micros / 1_000_000
  const digits = Math.abs(usd) < 0.1 ? 6 : Math.abs(usd) < 10 ? 4 : 2
  return `$${usd.toFixed(digits)}`
}

// ── 월 소진 예측 ────────────────────────────────

/** 'YYYY-MM' 의 날 수. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

export interface Burn {
  spentMicros: number
  capMicros: number
  /** 이번 달 지난 날 수 (오늘 포함) */
  elapsedDays: number
  daysInMonth: number
  perDayMicros: number
  /** 이 속도로 월말까지 가면 얼마인가 */
  projectedMicros: number
  /** 예측이 캡을 넘나 */
  exceedsCap: boolean
  /**
   * 이 속도로 며칠이면 캡에 닿나. 이미 닿았으면 0,
   * 이번 달 안에 안 닿으면 null — 없는 위험을 만들지 않는다.
   */
  daysUntilCap: number | null
  /** 0~100. 막대가 이 값이다 */
  percent: number
}

export function burnOf(args: {
  spentMicros: number
  capMicros: number
  today: string
}): Burn {
  const days = daysInMonth(args.today.slice(0, 7))
  const elapsed = Math.max(1, Number(args.today.slice(8, 10)))
  const perDay = args.spentMicros / elapsed
  const projected = Math.round(perDay * days)

  const left = Math.max(0, args.capMicros - args.spentMicros)
  const remainingDays = days - elapsed

  let daysUntilCap: number | null = null
  if (args.spentMicros >= args.capMicros) daysUntilCap = 0
  else if (perDay > 0) {
    const n = Math.ceil(left / perDay)
    if (n <= remainingDays) daysUntilCap = n
  }

  return {
    spentMicros: args.spentMicros,
    capMicros: args.capMicros,
    elapsedDays: elapsed,
    daysInMonth: days,
    perDayMicros: perDay,
    projectedMicros: projected,
    exceedsCap: projected > args.capMicros,
    daysUntilCap,
    percent: args.capMicros === 0
      ? 0
      : Math.min(100, Math.round((args.spentMicros / args.capMicros) * 100)),
  }
}

// ── 어디에 썼나 ─────────────────────────────────

export interface RouteCost {
  route: string
  calls: number
  /** 돈은 나갔는데 결과가 없는 호출 */
  failed: number
  costMicros: number
  /** 호출 하나당 평균 */
  avgMicros: number
  promptTokens: number
  completionTokens: number
}

/** 비싼 것부터. 어디를 줄여야 하는지가 첫 줄에 온다. */
export function byRoute(rows: LedgerRow[]): RouteCost[] {
  const acc = new Map<string, RouteCost>()

  for (const r of rows) {
    const cur = acc.get(r.route) ?? {
      route: r.route, calls: 0, failed: 0, costMicros: 0,
      avgMicros: 0, promptTokens: 0, completionTokens: 0,
    }
    cur.calls += 1
    if (!r.ok) cur.failed += 1
    cur.costMicros += r.costMicros ?? 0
    cur.promptTokens += r.promptTokens ?? 0
    cur.completionTokens += r.completionTokens ?? 0
    acc.set(r.route, cur)
  }

  return [...acc.values()]
    .map((c) => ({ ...c, avgMicros: c.calls === 0 ? 0 : Math.round(c.costMicros / c.calls) }))
    .sort((a, b) => b.costMicros - a.costMicros || a.route.localeCompare(b.route))
}

// ── 날짜별 ──────────────────────────────────────

export interface DayCost {
  date: string
  calls: number
  costMicros: number
  failed: number
}

/**
 * 날짜별 소비. 새 것부터.
 *
 * ★ 날짜는 KST 다. `created_at` 은 timestamptz 이고 서버는 UTC 로 도므로
 * SQL 의 date_trunc 로 묶으면 한국 시간 오전 9시 이전 호출이 전날로 간다.
 * 묶는 일을 여기서 하고 날짜는 `kstToday` 하나로만 만든다.
 */
export function byDay(rows: LedgerRow[], limit = 14): DayCost[] {
  const acc = new Map<string, DayCost>()

  for (const r of rows) {
    const date = kstToday(r.createdAt)
    const cur = acc.get(date) ?? { date, calls: 0, costMicros: 0, failed: 0 }
    cur.calls += 1
    cur.costMicros += r.costMicros ?? 0
    if (!r.ok) cur.failed += 1
    acc.set(date, cur)
  }

  return [...acc.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

// ── 재사용으로 아낀 것 ───────────────────────────

export interface Reuse {
  /** 실제로 만든 자료 수 */
  materials: number
  /** 그 자료가 쓰인 횟수 */
  uses: number
  /** 만들지 않고 다시 쓴 횟수 */
  reuses: number
  /** 다시 만들었다면 나갔을 돈 (추정) */
  savedMicros: number
}

/**
 * 멱등성 ②겹이 실제로 얼마를 막았나.
 *
 * ★ 추정이다. 자료 하나의 평균 생성비를 다시 쓴 횟수에 곱한다 —
 * 실제로 다시 만들었다면 프롬프트가 달라 값도 달랐을 것이므로
 * 정확한 금액이 아니라 규모다. 화면에서도 그렇게 말한다.
 */
export function reuseOf(args: {
  /** 자료가 필요했던 각 항목의 키. 같은 키가 여러 번 나오면 그만큼 다시 쓴 것 */
  usedKeys: string[]
  /** 실제로 만들어진 자료의 키 */
  generated: Set<string>
  /** 생성 경로(content · review)에 나간 총액 */
  generationCostMicros: number
}): Reuse {
  const used = args.usedKeys.filter((k) => args.generated.has(k))
  const materials = new Set(used).size
  const reuses = Math.max(0, used.length - materials)
  const avg = materials === 0 ? 0 : args.generationCostMicros / materials

  return {
    materials,
    uses: used.length,
    reuses,
    savedMicros: Math.round(reuses * avg),
  }
}
