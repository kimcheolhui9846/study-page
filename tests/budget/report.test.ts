import { describe, it, expect } from 'vitest'
import {
  burnOf, byDay, byRoute, daysInMonth, formatUsd, reuseOf, type LedgerRow,
} from '../../lib/budget/report'

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    createdAt: new Date('2026-09-02T01:00:00Z'),
    route: 'content',
    subject: 'cs',
    model: 'gpt-4o-mini',
    promptTokens: 1000,
    completionTokens: 500,
    costMicros: 600,
    ok: true,
    ...over,
  }
}

describe('금액 표기', () => {
  it('★ 한 번 호출이 $0.00 으로 뭉개지지 않는다', () => {
    // 실측: content 호출 하나가 $0.000559 였다. 두 자리로 자르면 사라진다.
    expect(formatUsd(559)).toBe('$0.000559')
  })

  it('금액이 커지면 자릿수를 줄인다', () => {
    expect(formatUsd(1_500_000)).toBe('$1.5000')
    expect(formatUsd(42_000_000)).toBe('$42.00')
  })

  it('0 도 자릿수를 지킨다', () => {
    expect(formatUsd(0)).toBe('$0.000000')
  })
})

describe('달의 날 수', () => {
  it('30일 · 31일 · 윤년을 안다', () => {
    expect(daysInMonth('2026-09')).toBe(30)
    expect(daysInMonth('2026-12')).toBe(31)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
  })
})

describe('월 소진 예측', () => {
  const cap = 3_000_000 // $3.00

  it('★ 지금 속도로 월말에 얼마인지 말한다', () => {
    // 9월 2일까지 $0.02 → 하루 $0.01 → 30일이면 $0.30
    const b = burnOf({ spentMicros: 20_000, capMicros: cap, today: '2026-09-02' })

    expect(b.elapsedDays).toBe(2)
    expect(b.daysInMonth).toBe(30)
    expect(b.perDayMicros).toBe(10_000)
    expect(b.projectedMicros).toBe(300_000)
    expect(b.exceedsCap).toBe(false)
  })

  it('★ 캡을 넘길 속도면 넘는다고 말한다', () => {
    // 이틀에 $1 → 30일이면 $15. 캡 $3 을 훨씬 넘는다.
    const b = burnOf({ spentMicros: 1_000_000, capMicros: cap, today: '2026-09-02' })

    expect(b.exceedsCap).toBe(true)
    expect(b.daysUntilCap).toBe(4) // 남은 $2 를 하루 $0.5 로
  })

  it('이번 달 안에 캡에 안 닿으면 날짜를 지어내지 않는다', () => {
    expect(burnOf({ spentMicros: 20_000, capMicros: cap, today: '2026-09-02' }).daysUntilCap)
      .toBeNull()
  })

  it('한 푼도 안 썼으면 예측도 0 이다', () => {
    const b = burnOf({ spentMicros: 0, capMicros: cap, today: '2026-09-15' })
    expect(b.projectedMicros).toBe(0)
    expect(b.daysUntilCap).toBeNull()
    expect(b.percent).toBe(0)
  })

  it('★ 이미 캡에 닿았으면 0일이다', () => {
    const b = burnOf({ spentMicros: cap, capMicros: cap, today: '2026-09-10' })
    expect(b.daysUntilCap).toBe(0)
    expect(b.percent).toBe(100)
  })

  it('캡을 넘겨도 막대는 100 을 안 넘는다', () => {
    expect(burnOf({ spentMicros: cap * 2, capMicros: cap, today: '2026-09-10' }).percent)
      .toBe(100)
  })
})

describe('경로별 비용', () => {
  const rows = [
    row({ route: 'content', costMicros: 600 }),
    row({ route: 'content', costMicros: 560 }),
    row({ route: 'grade', costMicros: 608 }),
    row({ route: 'grade', costMicros: 0, ok: false, promptTokens: null, completionTokens: null }),
  ]

  it('★ 비싼 것부터 준다 — 줄일 곳이 첫 줄에 온다', () => {
    expect(byRoute(rows).map((r) => r.route)).toEqual(['content', 'grade'])
  })

  it('호출 수 · 총액 · 평균을 함께 낸다', () => {
    const content = byRoute(rows)[0]!
    expect(content.calls).toBe(2)
    expect(content.costMicros).toBe(1160)
    expect(content.avgMicros).toBe(580)
    expect(content.promptTokens).toBe(2000)
  })

  it('★ 실패한 호출을 따로 센다 — 돈은 나갔는데 결과가 없는 것들이다', () => {
    expect(byRoute(rows).find((r) => r.route === 'grade')!.failed).toBe(1)
  })

  it('토큰이 없어도 터지지 않는다', () => {
    expect(byRoute([row({ promptTokens: null, completionTokens: null, costMicros: null })])[0])
      .toMatchObject({ costMicros: 0, promptTokens: 0, avgMicros: 0 })
  })

  it('빈 원장은 빈 배열이다', () => {
    expect(byRoute([])).toEqual([])
  })
})

describe('날짜별 비용', () => {
  it('★ KST 로 묶는다 — UTC 로 묶으면 새벽 공부가 전날로 간다', () => {
    // 2026-09-02T23:30Z = KST 2026-09-03 08:30. 한국에서는 3일 아침이다.
    const d = byDay([
      row({ createdAt: new Date('2026-09-02T23:30:00Z'), costMicros: 100 }),
      row({ createdAt: new Date('2026-09-02T01:00:00Z'), costMicros: 200 }),
    ])

    expect(d.map((x) => x.date)).toEqual(['2026-09-03', '2026-09-02'])
    expect(d[0]!.costMicros).toBe(100)
  })

  it('새 날짜부터 주고 개수를 자른다', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ createdAt: new Date(`2026-09-${String(i + 1).padStart(2, '0')}T05:00:00Z`) }))

    const d = byDay(many, 5)
    expect(d).toHaveLength(5)
    expect(d[0]!.date).toBe('2026-09-20')
  })
})

describe('재사용 절감', () => {
  it('★ 같은 자료를 다시 쓴 만큼을 아낀 것으로 센다', () => {
    // 자료 2개를 만드는 데 $0.0012. 그 둘을 도합 5번 썼으니 3번은 공짜였다.
    const r = reuseOf({
      usedKeys: ['a', 'a', 'a', 'b', 'b'],
      generated: new Set(['a', 'b']),
      generationCostMicros: 1200,
    })

    expect(r.materials).toBe(2)
    expect(r.uses).toBe(5)
    expect(r.reuses).toBe(3)
    expect(r.savedMicros).toBe(1800) // 3 × 평균 600
  })

  it('★ 만들어지지 않은 자료는 세지 않는다 — 계획만 되고 안 한 것이 있다', () => {
    const r = reuseOf({
      usedKeys: ['a', 'a', 'never-made'],
      generated: new Set(['a']),
      generationCostMicros: 600,
    })

    expect(r.uses).toBe(2)
    expect(r.reuses).toBe(1)
    expect(r.savedMicros).toBe(600)
  })

  it('아무것도 안 만들었으면 0 이다', () => {
    expect(reuseOf({ usedKeys: [], generated: new Set(), generationCostMicros: 0 }))
      .toMatchObject({ materials: 0, reuses: 0, savedMicros: 0 })
  })
})
