/**
 * 모델과 단가.
 *
 * 단가가 바뀌면 이 파일만 고친다. 다른 곳에서 숫자를 복사하지 않는다.
 * 확인 근거와 다른 모델과의 비교는 docs/DECISIONS.md 에 있다.
 *
 *   gpt-4o-mini   — 2026-09-01 확인. 커리큘럼 경로(자료·채점·해설)가 쓴다
 *   gpt-6-luna    — 2026-11-16 확인. 자유학습의 대화(라우터)
 *   gpt-6.1-terra — 2026-11-16 확인. 자유학습의 자료 생성·피드백
 */
export const MODEL = 'gpt-4o-mini'
export const CHAT_MODEL = 'gpt-6-luna'
export const WORK_MODEL = 'gpt-6.1-terra'

/** per 1M tokens, USD 마이크로 단위 (1 USD = 1,000,000) */
const PRICES: Record<string, { input: number; output: number }> = {
  [MODEL]:      { input: 150_000,   output: 600_000 },   // $0.15 / $0.60
  [CHAT_MODEL]: { input: 100_000,   output: 500_000 },   // $0.10 / $0.50
  [WORK_MODEL]: { input: 1_000_000, output: 5_000_000 }, // $1.00 / $5.00
}

/**
 * 추론 모델인가. 추론 모델은 요청 파라미터가 다르다 —
 * `max_completion_tokens` + `reasoning_effort` 를 받고, 추론 토큰이 출력으로 과금된다.
 */
export function isReasoningModel(model: string): boolean {
  return model === CHAT_MODEL || model === WORK_MODEL
}

function priceOf(model: string) {
  const p = PRICES[model]
  // 단가를 모르는 모델을 0원으로 기록하면 원장과 월 캡이 거짓말한다. 던진다.
  if (!p) throw new Error(`단가가 등록되지 않은 모델이다: ${model}`)
  return p
}

/**
 * 토큰 수를 비용으로 바꾼다.
 *
 * 정수 마이크로달러로 계산한다. 부동소수 달러를 누적하면 오차가 쌓이고,
 * usage_ledger.cost_micros 가 integer 컬럼이라 어차피 정수여야 한다.
 * 올림한다 — 비용을 낮게 잡는 실수를 하지 않는다.
 */
export function costMicros(
  promptTokens: number, completionTokens: number, model: string = MODEL,
): number {
  const p = priceOf(model)
  const input = (promptTokens * p.input) / 1_000_000
  const output = (completionTokens * p.output) / 1_000_000
  return Math.ceil(input + output)
}

/**
 * 사용량을 모르는 실패(타임아웃·연결 끊김)에 매기는 보수적 상한.
 *
 * 요청이 OpenAI 에 닿아 처리됐을 수 있으므로 0원으로 두지 않는다. 입력은
 * 문자 2개당 1토큰(한국어는 대개 이보다 적다), 출력은 상한을 다 쓴 것으로 본다.
 */
export function maxCostMicros(model: string, promptChars: number, maxCompletionTokens: number): number {
  return costMicros(Math.ceil(promptChars / 2), maxCompletionTokens, model)
}
