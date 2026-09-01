import { MODEL, costMicros } from './pricing'
import type { LlmClient, LlmRequest, LlmResult } from './types'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const TIMEOUT_MS = 30_000

/**
 * ★ 이 파일이 OPENAI_API_KEY 의 유일한 소비처다 (CLAUDE.md).
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

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        // 키는 헤더로만 간다. URL 에 넣으면 로그와 프록시에 남는다.
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: req.temperature,
        max_tokens: req.maxTokens, // 무제한 금지 — 비용 게이트다
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      // 응답 본문을 메시지에 넣지 않는다. 키가 에코되어 돌아올 수 있고
      // 그러면 로그에 키가 남는다. 상태 코드만으로 충분히 진단된다.
      throw new Error(`OpenAI 호출 실패: HTTP ${res.status}`)
    }

    const body = await res.json()
    const choice = body.choices?.[0]

    // 잘린 응답은 형식이 맞아 보여도 반쪽이다. DB 에 넣으면 그 Day 는
    // 평생 UNIQUE 제약에 묶여 되살릴 수 없다. 여기서 막는다.
    if (choice?.finish_reason === 'length') {
      throw new Error('응답이 max_tokens 에서 잘렸습니다')
    }

    const promptTokens = body.usage?.prompt_tokens ?? 0
    const completionTokens = body.usage?.completion_tokens ?? 0

    return {
      data: JSON.parse(choice.message.content) as T,
      promptTokens,
      completionTokens,
      costMicros: costMicros(promptTokens, completionTokens),
    }
  }
}
