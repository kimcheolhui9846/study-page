import { describe, it, expect } from 'vitest'
import { parseId, readBody, toResponse } from '../../lib/study/http'
import type { EngineError } from '../../lib/study/engine'

describe('toResponse', () => {
  it.each([
    ['BUDGET_EXCEEDED', 429],
    ['GENERATION_FAILED', 502],
    ['INVALID_OUTPUT', 502],
    ['IN_PROGRESS', 409],
    ['NOT_FOUND', 404],
    ['INVALID_INPUT', 400],
    ['REQUEST_MISMATCH', 409],
    ['NO_MORE_HINTS', 409],
    ['ATTEMPT_LIMIT', 409],
  ] as Array<[EngineError, number]>)('%s → %d', async (code, status) => {
    const res = toResponse({ ok: false, code, message: 'm' })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code, message: 'm' })
  })

  it('성공은 값과 재생 여부를 준다', async () => {
    const res = toResponse({ ok: true, value: { sessionId: 3 }, replayed: true }, 201)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ sessionId: 3, replayed: true })
  })
})

describe('parseId', () => {
  it.each([['12', 12], ['0', null], ['-1', null], ['1e3', null], ['abc', null], ['9007199254740993', null]])(
    '%s → %s', (s, n) => { expect(parseId(s)).toBe(n) },
  )
})

describe('readBody', () => {
  it('JSON 이 아니면 null', async () => {
    expect(await readBody(new Request('http://x', { method: 'POST', body: 'nope' }))).toBeNull()
  })

  it('객체만 받는다', async () => {
    const req = (b: string) => new Request('http://x', { method: 'POST', body: b })
    expect(await readBody(req('[1]'))).toBeNull()
    expect(await readBody(req('{"a":1}'))).toEqual({ a: 1 })
  })
})
