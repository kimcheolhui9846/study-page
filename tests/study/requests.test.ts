import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import type { Db } from '../../lib/db/types'
import { claimRequest, failRequest, finishRequest, isRequestId } from '../../lib/study/requests'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-11-16T03:00:00Z')
const ID = '7b0c3c4e-5f8a-4d2b-9a51-0c6f1e2d3a4b'

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

describe('ai_requests 멱등성', () => {
  it('처음은 new, 처리 중 다시 오면 pending', async () => {
    expect(await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 1 }))
      .toEqual({ kind: 'new' })
    expect(await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 1 }))
      .toEqual({ kind: 'pending' })
  })

  it('★ 끝난 요청은 저장된 결과를 돌려준다', async () => {
    await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 1 })
    await finishRequest(db, clock, ID, { messageIds: [1, 2] })
    expect(await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 1 }))
      .toEqual({ kind: 'done', result: { messageIds: [1, 2] } })
  })

  it('실패한 요청은 실패를 돌려준다 — 같은 ID 로 다시 부르지 않는다', async () => {
    await claimRequest(db, clock, { requestId: ID, action: 'more', sessionId: 1 })
    await failRequest(db, clock, ID, 'BUDGET_EXCEEDED')
    expect(await claimRequest(db, clock, { requestId: ID, action: 'more', sessionId: 1 }))
      .toEqual({ kind: 'failed', errorCode: 'BUDGET_EXCEEDED' })
  })

  it('★ 동시에 두 번 와도 하나만 new 다', async () => {
    const [a, b] = await Promise.all([
      claimRequest(db, clock, { requestId: ID, action: 'start', sessionId: null }),
      claimRequest(db, clock, { requestId: ID, action: 'start', sessionId: null }),
    ])
    expect([a.kind, b.kind].filter((k) => k === 'new')).toHaveLength(1)
  })

  it('★ 같은 ID 를 다른 행동·세션에 쓰면 mismatch', async () => {
    await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 1 })
    expect((await claimRequest(db, clock, { requestId: ID, action: 'submit', sessionId: 1 })).kind)
      .toBe('mismatch')
    expect((await claimRequest(db, clock, { requestId: ID, action: 'message', sessionId: 2 })).kind)
      .toBe('mismatch')
  })

  it('요청 ID 형식', () => {
    expect(isRequestId(ID)).toBe(true)
    expect(isRequestId('abc')).toBe(false)
    expect(isRequestId(123)).toBe(false)
    expect(isRequestId(`${ID}x`)).toBe(false)
  })
})
