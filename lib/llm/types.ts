export interface LlmResult<T> {
  data: T
  promptTokens: number
  completionTokens: number
  costMicros: number
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'

export interface LlmRequest {
  /** usage_ledger 에 남는 라우트 이름. 'content' | 'grade' | 'study-chat' … */
  route: string
  /** 생략하면 커리큘럼 경로의 모델(gpt-4o-mini) */
  model?: string
  system: string
  user: string
  /** Structured Outputs 의 스키마 이름. 응답 형식을 식별한다 */
  schemaName: string
  /** OpenAI Structured Outputs 에 보낼 strict JSON Schema */
  jsonSchema: object
  /**
   * 무제한 금지 — 비용 게이트다.
   * 추론 모델에서는 `max_completion_tokens` 로 가고 추론 토큰까지 포함한다.
   */
  maxTokens: number
  /** 비추론 모델만. content 0.6 · grade 0.0 · polish 0.4. 채점의 0 은 필수다 */
  temperature?: number
  /** 추론 모델만. 생략하면 'low' */
  reasoningEffort?: ReasoningEffort
  /** 생략하면 30초 */
  timeoutMs?: number
}

export interface LlmClient {
  /**
   * 스키마에 맞는 JSON 을 생성한다.
   *
   * 구현체는 OpenAiLlmClient(실제)와 테스트용 가짜들이다.
   * 테스트에서 실제 LLM 을 부르지 않는다는 규칙이 이 인터페이스 덕분에 성립한다.
   */
  generate<T>(req: LlmRequest): Promise<LlmResult<T>>
}
