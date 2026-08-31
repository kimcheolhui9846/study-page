export interface LlmResult<T> {
  data: T
  promptTokens: number
  completionTokens: number
  costMicros: number
}

export interface LlmClient {
  /**
   * 스키마에 맞는 JSON 을 생성한다.
   *
   * 2주차에 OpenAI Structured Outputs 로 구현한다.
   * 1주차에는 FakeLlmClient 만 존재하며, 그것이 "실제 호출 0회"의 구조적 보장이다.
   */
  generate<T>(args: {
    route: string
    system: string
    user: string
    schemaName: string
    maxTokens: number
    temperature: number
  }): Promise<LlmResult<T>>
}
