export interface LlmResult<T> {
  data: T
  promptTokens: number
  completionTokens: number
  costMicros: number
}

export interface LlmRequest {
  /** usage_ledger 에 남는 라우트 이름. 'content' | 'grade' | 'polish' */
  route: string
  system: string
  user: string
  /** Structured Outputs 의 스키마 이름. 응답 형식을 식별한다 */
  schemaName: string
  /** OpenAI Structured Outputs 에 보낼 strict JSON Schema */
  jsonSchema: object
  /** 무제한 금지 — 비용 게이트다 */
  maxTokens: number
  /** content 0.6 · grade 0.0 · polish 0.4. 채점의 0 은 필수다 */
  temperature: number
}

export interface LlmClient {
  /**
   * 스키마에 맞는 JSON 을 생성한다.
   *
   * 구현체는 둘이다 — OpenAiLlmClient(실제)와 FakeLlmClient(테스트).
   * 테스트에서 실제 LLM 을 부르지 않는다는 규칙이 이 인터페이스 덕분에 성립한다.
   */
  generate<T>(req: LlmRequest): Promise<LlmResult<T>>
}
