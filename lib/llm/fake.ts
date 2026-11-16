import { costMicros } from './pricing'
import type { LlmClient, LlmRequest, LlmResult } from './types'

const DEFAULT_PAYLOAD = {
  passage: { title: '가짜 지문', body_md: '본문', key_terms: [] },
  questions: [
    { id: 'q1', type: 'recall',      prompt: '문제 1', expected_points: ['포인트'], hint: '힌트' },
    { id: 'q2', type: 'concept',     prompt: '문제 2', expected_points: ['포인트'], hint: '힌트' },
    { id: 'q3', type: 'application', prompt: '문제 3', expected_points: ['포인트'], hint: '힌트' },
  ],
}

/**
 * 1주차의 유일한 LlmClient 구현체.
 *
 * 호출 횟수를 세므로 "멱등성 덕분에 호출이 1회였다"를 테스트가 주장이 아니라
 * 단언으로 만들 수 있다. 지우지 말 것 — 모든 통합 테스트가 이걸 주입해서 돈다.
 */
export class FakeLlmClient implements LlmClient {
  calls = 0

  constructor(private readonly payload: unknown = DEFAULT_PAYLOAD) {}

  async generate<T>(): Promise<LlmResult<T>> {
    this.calls += 1
    return {
      data: this.payload as T,
      promptTokens: 800,
      completionTokens: 1200,
      costMicros: 840,
    }
  }
}

/** 항상 던지는 클라이언트. 롤백 경로를 테스트하기 위해 존재한다. */
export class FailingLlmClient implements LlmClient {
  calls = 0

  async generate<T>(): Promise<LlmResult<T>> {
    this.calls += 1
    throw new Error('LLM 호출 실패 (테스트)')
  }
}

/**
 * 요청마다 응답을 고르는 가짜 클라이언트. 자유학습 테스트가 쓴다.
 *
 * respond 가 Error 를 돌려주면 그것을 던진다 — 실패 정산 갈래를 시험할 때.
 * 받은 요청을 전부 남기므로 「어떤 모델로 무엇을 보냈는가」를 단언할 수 있다.
 */
export class ScriptedLlmClient implements LlmClient {
  requests: LlmRequest[] = []

  constructor(private readonly respond: (req: LlmRequest, n: number) => unknown) {}

  get calls(): number {
    return this.requests.length
  }

  async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
    this.requests.push(req)
    const out = this.respond(req, this.requests.length)
    if (out instanceof Error) throw out
    return {
      data: out as T,
      promptTokens: 1000,
      completionTokens: 1000,
      costMicros: costMicros(1000, 1000, req.model),
    }
  }
}
