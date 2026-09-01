import { describe, it, expect } from 'vitest'
import { MODEL, costMicros } from '../../lib/llm/pricing'

describe('costMicros', () => {
  it('모델은 gpt-4o-mini 다', () => {
    expect(MODEL).toBe('gpt-4o-mini')
  })

  it('입력 1M 토큰은 $0.15 = 150,000 마이크로다', () => {
    expect(costMicros(1_000_000, 0)).toBe(150_000)
  })

  it('출력 1M 토큰은 $0.60 = 600,000 마이크로다', () => {
    expect(costMicros(0, 1_000_000)).toBe(600_000)
  })

  it('둘을 더한다', () => {
    expect(costMicros(1_000_000, 1_000_000)).toBe(750_000)
  })

  it('★ 정수를 반환한다 — usage_ledger 가 integer 컬럼이다', () => {
    expect(Number.isInteger(costMicros(1234, 5678))).toBe(true)
  })

  it('0 토큰은 0 이다', () => {
    expect(costMicros(0, 0)).toBe(0)
  })

  it('실제 한 번의 콘텐츠 생성 규모를 계산한다', () => {
    // 입력 500 / 출력 2000 토큰 ≈ $0.0013
    expect(costMicros(500, 2000)).toBe(1275)
  })
})
