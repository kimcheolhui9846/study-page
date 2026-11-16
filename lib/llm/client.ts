import { MODEL, costMicros, isReasoningModel } from './pricing'
import type { LlmClient, LlmRequest, LlmResult } from './types'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const TIMEOUT_MS = 30_000

/**
 * 실패를 셋으로 나눈다. 비용 정산이 다르기 때문이다 (lib/study/call.ts).
 *
 *   LlmHttpError      — OpenAI 가 응답으로 거절했다. 생성하지 않았으니 과금이 없다
 *   LlmTransportError — 연결이 끊겼거나 시간이 넘었다. 요청이 처리됐을 수 있다
 *   LlmTruncatedError — 응답은 왔지만 상한에서 잘렸다. 사용량은 정확히 안다
 *
 * 모두 Error 를 상속하므로 `catch {}` 로 뭉뚱그려 받던 기존 경로는 그대로 돈다.
 */
export class LlmHttpError extends Error {
  constructor(readonly status: number) {
    // 응답 본문을 메시지에 넣지 않는다. 키가 에코되어 돌아올 수 있다.
    super(`OpenAI 호출 실패: HTTP ${status}`)
    this.name = 'LlmHttpError'
  }
}

export class LlmTransportError extends Error {
  constructor() {
    super('OpenAI 에 닿지 못했거나 시간이 초과됐다')
    this.name = 'LlmTransportError'
  }
}

export class LlmTruncatedError extends Error {
  constructor(
    readonly promptTokens: number,
    readonly completionTokens: number,
    readonly costMicros: number,
  ) {
    super('응답이 max_tokens 에서 잘렸습니다')
    this.name = 'LlmTruncatedError'
  }
}

/**
 * ★ 이 파일이 OPENAI_API_KEY 의 유일한 소비처다 (AGENTS.md).
 * tests/api-key-boundary.test.ts 가 그것을 강제한다.
 *
 * openai 패키지를 쓰지 않고 fetch 로 직접 부른다:
 *   - 의존성이 늘지 않고 버셀 번들이 가볍다
 *   - AbortSignal.timeout 을 완전히 제어한다
 *   - Structured Outputs 는 JSON 바디 하나라 SDK 가 필요 없다
 */
export class OpenAiLlmClient implements LlmClient {
  async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
    const key = process.env.OPENAI_API_KEY
    // 키가 없으면 네트워크를 때리지 않는다. 401 을 받아보고 알 이유가 없다.
    if (!key) throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다')

    const model = req.model ?? MODEL
    // 추론 모델은 temperature 대신 추론 강도를 받고, 상한은 추론 토큰까지 센다.
    // 기존 경로(gpt-4o-mini)의 요청 본문은 바꾸지 않는다.
    const limits = isReasoningModel(model)
      ? { max_completion_tokens: req.maxTokens, reasoning_effort: req.reasoningEffort ?? 'low' }
      : { temperature: req.temperature, max_tokens: req.maxTokens } // 무제한 금지 — 비용 게이트다

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          // 키는 헤더로만 간다. URL 에 넣으면 로그와 프록시에 남는다.
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          ...limits,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.schemaName,
              strict: true,
              schema: req.jsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
      })
    } catch {
      throw new LlmTransportError()
    }

    if (!res.ok) {
      // 응답 본문을 메시지에 넣지 않는다. 키가 에코되어 돌아올 수 있고
      // 그러면 로그에 키가 남는다. 상태 코드만으로 충분히 진단된다.
      throw new LlmHttpError(res.status)
    }

    const body = await res.json()
    const choice = body.choices?.[0]

    const promptTokens = body.usage?.prompt_tokens ?? 0
    const completionTokens = body.usage?.completion_tokens ?? 0
    const cost = costMicros(promptTokens, completionTokens, model)

    // 잘린 응답은 형식이 맞아 보여도 반쪽이다. DB 에 넣으면 되살릴 수 없다.
    // 여기서 막는다. 돈은 이미 나갔으므로 사용량을 들고 던진다.
    if (choice?.finish_reason === 'length') {
      throw new LlmTruncatedError(promptTokens, completionTokens, cost)
    }

    return {
      data: JSON.parse(choice.message.content) as T,
      promptTokens,
      completionTokens,
      costMicros: cost,
    }
  }
}
