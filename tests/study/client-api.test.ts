import { describe, it, expect, afterEach, vi } from 'vitest'
import { classify, postStudy, stateMessage } from '../../lib/study/client-api'

afterEach(() => { vi.unstubAllGlobals() })

describe('classify — 상태를 가른다', () => {
  it.each([
    [200, undefined, 'ok'],
    [201, undefined, 'ok'],
    [401, 'SESSION_EXPIRED', 'expired'],
    [429, 'BUDGET_EXCEEDED', 'budget'],
    [409, 'IN_PROGRESS', 'in-progress'],
    [409, 'NO_MORE_HINTS', 'invalid'],
    [502, 'GENERATION_FAILED', 'failed'],
    [502, 'INVALID_OUTPUT', 'failed'],
    [500, undefined, 'save-failed'],
    [400, 'INVALID_INPUT', 'invalid'],
    [404, 'NOT_FOUND', 'invalid'],
    [0, undefined, 'network'],
  ] as const)('%d %s → %s', (status, code, state) => {
    expect(classify(status, code)).toBe(state)
  })

  it('상태마다 다른 문구다', () => {
    const states = ['in-progress', 'budget', 'expired', 'failed', 'save-failed', 'network'] as const
    expect(new Set(states.map((s) => stateMessage(s))).size).toBe(states.length)
  })
})

describe('postStudy', () => {
  it('요청 ID 를 본문에 담는다', async () => {
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ sessionId: 1 }), { status: 201 })
    }))
    const r = await postStudy('/api/study/sessions', { mode: 'cs' }, 'rid')
    expect(sent).toEqual({ mode: 'cs', requestId: 'rid' })
    expect(r).toEqual({ state: 'ok', data: { sessionId: 1 } })
  })

  it('fetch 가 던지면 network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect((await postStudy('/x', {}, 'r')).state).toBe('network')
  })

  it('서버 메시지를 그대로 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'BUDGET_EXCEEDED', message: '한도' }), { status: 429 },
    )))
    expect(await postStudy('/x', {}, 'r')).toEqual({ state: 'budget', message: '한도', code: 'BUDGET_EXCEEDED' })
  })
})
