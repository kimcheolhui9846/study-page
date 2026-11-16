import { describe, it, expect } from 'vitest'
import {
  MODEL, CHAT_MODEL, WORK_MODEL, costMicros, isReasoningModel, maxCostMicros,
} from '../../lib/llm/pricing'

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

describe('costMicros — 모델별 단가 (2026-11-16 공식 가격표)', () => {
  it('gpt-6-luna 는 $0.10 / $0.50 이다', () => {
    expect(costMicros(1_000_000, 0, CHAT_MODEL)).toBe(100_000)
    expect(costMicros(0, 1_000_000, CHAT_MODEL)).toBe(500_000)
  })

  it('gpt-6.1-terra 는 $1 / $5 이다', () => {
    expect(costMicros(1_000_000, 0, WORK_MODEL)).toBe(1_000_000)
    expect(costMicros(0, 1_000_000, WORK_MODEL)).toBe(5_000_000)
  })

  it('모델을 생략하면 기존 경로(gpt-4o-mini) 단가다', () => {
    expect(costMicros(500, 2000)).toBe(costMicros(500, 2000, MODEL))
  })

  it('★ 모르는 모델은 던진다 — 단가 0 으로 조용히 넘어가면 원장이 거짓말한다', () => {
    expect(() => costMicros(1, 1, 'gpt-unknown')).toThrow(/단가/)
  })

  it('추론 모델을 가린다', () => {
    expect(isReasoningModel(CHAT_MODEL)).toBe(true)
    expect(isReasoningModel(WORK_MODEL)).toBe(true)
    expect(isReasoningModel(MODEL)).toBe(false)
  })

  it('maxCostMicros 는 입력을 문자 2개당 1토큰으로, 출력을 상한까지 쓴 것으로 본다', () => {
    // 4000자 → 2000토큰 × $1 + 12000토큰 × $5 = 2000 + 60000
    expect(maxCostMicros(WORK_MODEL, 4000, 12_000)).toBe(62_000)
  })
})
