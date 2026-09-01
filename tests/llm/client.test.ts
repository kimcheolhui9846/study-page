import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenAiLlmClient } from '../../lib/llm/client'
import type { LlmRequest } from '../../lib/llm/types'

/**
 * 실제 호출은 하지 않는다. fetch 를 스텁해서 요청 본문과 오류 처리를 본다.
 * 이 파일이 도는 동안 돈은 한 푼도 나가지 않는다.
 */
const okBody = (
  content: object,
  usage = { prompt_tokens: 100, completion_tokens: 200 },
) => ({
  choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
  usage,
})

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch))
}

const req: LlmRequest = {
  route: 'content',
  system: '시스템',
  user: '사용자',
  schemaName: 'study_content',
  jsonSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  maxTokens: 2000,
  temperature: 0.6,
}

beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'sk-test-key') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('OpenAiLlmClient', () => {
  it('요청 본문에 strict json_schema 를 담는다', async () => {
    let sent: Record<string, unknown> = {}
    stubFetch(async (_url, init) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)

    expect(sent.model).toBe('gpt-4o-mini')
    expect(sent.temperature).toBe(0.6)
    expect(sent.max_tokens).toBe(2000)

    const rf = sent.response_format as {
      type: string
      json_schema: { strict: boolean; name: string }
    }
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema.strict).toBe(true)
    expect(rf.json_schema.name).toBe('study_content')
  })

  it('시스템과 사용자 메시지를 순서대로 담는다', async () => {
    let sent: { messages?: Array<{ role: string; content: string }> } = {}
    stubFetch(async (_url, init) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)

    expect(sent.messages).toEqual([
      { role: 'system', content: '시스템' },
      { role: 'user', content: '사용자' },
    ])
  })

  it('★ API 키를 Authorization 헤더로만 보낸다 — URL 에 넣지 않는다', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    stubFetch(async (u, init) => {
      url = u
      headers = init.headers as Record<string, string>
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)

    expect(url).not.toContain('sk-test-key')
    expect(headers.Authorization).toBe('Bearer sk-test-key')
  })

  it('토큰 수와 비용을 함께 준다', async () => {
    stubFetch(async () => new Response(
      JSON.stringify(okBody({ ok: true }, { prompt_tokens: 500, completion_tokens: 2000 })),
      { status: 200 },
    ))

    const r = await new OpenAiLlmClient().generate(req)
    expect(r.promptTokens).toBe(500)
    expect(r.completionTokens).toBe(2000)
    expect(r.costMicros).toBe(1275) // costMicros(500, 2000)
  })

  it('파싱한 데이터를 준다', async () => {
    stubFetch(async () => new Response(
      JSON.stringify(okBody({ passage: { title: '제목' } })), { status: 200 },
    ))

    const r = await new OpenAiLlmClient().generate<{ passage: { title: string } }>(req)
    expect(r.data.passage.title).toBe('제목')
  })

  it('★ 키가 없으면 네트워크를 때리지 않고 던진다', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/OPENAI_API_KEY/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('HTTP 오류를 던진다 — 상태 코드를 메시지에 담는다', async () => {
    stubFetch(async () => new Response('rate limited', { status: 429 }))
    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/429/)
  })

  it('★ 오류 메시지에 API 키가 섞이지 않는다', async () => {
    // 응답 본문에 키가 에코되어 돌아오는 상황을 흉내낸다.
    stubFetch(async () => new Response('bad key sk-test-key leaked', { status: 401 }))

    const err = await new OpenAiLlmClient().generate(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('sk-test-key')
  })

  it('★ 잘린 응답(finish_reason=length)을 던진다 — 반쪽 JSON 을 DB 에 넣지 않는다', async () => {
    stubFetch(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }), { status: 200 }))

    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/max_tokens/)
  })

  it('타임아웃 시그널을 붙인다', async () => {
    let hasSignal = false
    stubFetch(async (_u, init) => {
      hasSignal = init.signal instanceof AbortSignal
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)
    expect(hasSignal).toBe(true)
  })

  it('usage 가 없어도 죽지 않는다 — 0 으로 본다', async () => {
    stubFetch(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    }), { status: 200 }))

    const r = await new OpenAiLlmClient().generate(req)
    expect(r.promptTokens).toBe(0)
    expect(r.costMicros).toBe(0)
  })
})
