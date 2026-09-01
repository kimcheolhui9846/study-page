/**
 * 모델과 단가. 2026-09-01 확인값.
 *
 * 단가가 바뀌면 이 파일만 고친다. 다른 곳에서 숫자를 복사하지 않는다.
 * 확인 근거와 다른 모델과의 비교는 docs/DECISIONS.md 에 있다.
 */
export const MODEL = 'gpt-4o-mini'

/** per 1M tokens, USD 마이크로 단위 (1 USD = 1,000,000) */
const INPUT_MICROS_PER_1M = 150_000 // $0.15
const OUTPUT_MICROS_PER_1M = 600_000 // $0.60

/**
 * 토큰 수를 비용으로 바꾼다.
 *
 * 정수 마이크로달러로 계산한다. 부동소수 달러를 누적하면 오차가 쌓이고,
 * usage_ledger.cost_micros 가 integer 컬럼이라 어차피 정수여야 한다.
 * 올림한다 — 비용을 낮게 잡는 실수를 하지 않는다.
 */
export function costMicros(promptTokens: number, completionTokens: number): number {
  const input = (promptTokens * INPUT_MICROS_PER_1M) / 1_000_000
  const output = (completionTokens * OUTPUT_MICROS_PER_1M) / 1_000_000
  return Math.ceil(input + output)
}
