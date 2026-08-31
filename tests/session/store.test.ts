import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore, hashToken } from '../../lib/session/postgres'
import { IDLE_TTL_MS, ABSOLUTE_TTL_MS } from '../../lib/session/store'
import { sessions } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

const START = '2026-09-01T00:00:00Z'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let store: PostgresSessionStore

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock(START)
  store = new PostgresSessionStore(db, clock)
})
afterEach(async () => { await close() })

describe('세션 발급', () => {
  it('원본 토큰이 DB에 저장되지 않는다 — 해시만 저장한다', async () => {
    const { token } = await store.create()
    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(token)
    expect(rows[0].tokenHash).toBe(hashToken(token))
  })

  it('매번 다른 토큰을 준다', async () => {
    const a = await store.create()
    const b = await store.create()
    expect(a.token).not.toBe(b.token)
  })

  it('추측하기 어려운 길이의 토큰이다', async () => {
    const { token } = await store.create()
    expect(token.length).toBeGreaterThanOrEqual(43) // 32바이트 base64url
  })

  it('절대 만료를 2시간 뒤로 잡는다', async () => {
    const { expiresAt } = await store.create()
    expect(expiresAt.getTime()).toBe(new Date(START).getTime() + ABSOLUTE_TTL_MS)
  })
})

describe('세션 검증 — 통과 경로', () => {
  it('갓 만든 세션은 통과한다', async () => {
    const { token } = await store.create()
    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })

  it('활동할 때마다 유휴 만료가 밀린다', async () => {
    const { token } = await store.create()
    clock.advance(10 * 60 * 1000)
    const s = await store.verifyAndTouch(token)
    expect(s!.idleExpiresAt.getTime()).toBe(clock.now().getTime() + IDLE_TTL_MS)

    clock.advance(10 * 60 * 1000) // 시작으로부터 20분. 밀렸으므로 살아있어야 한다
    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })

  it('활동해도 절대 만료는 밀리지 않는다', async () => {
    const { token } = await store.create()
    clock.advance(10 * 60 * 1000)
    const s = await store.verifyAndTouch(token)
    expect(s!.expiresAt.getTime()).toBe(new Date(START).getTime() + ABSOLUTE_TTL_MS)
  })
})

describe('세션 검증 — 차단 4경로', () => {
  it('① 없는 토큰은 막는다', async () => {
    expect(await store.verifyAndTouch('존재하지-않는-토큰')).toBeNull()
  })

  it('② 유휴 15분을 넘기면 막는다 — 자리 비움', async () => {
    const { token } = await store.create()
    clock.advance(IDLE_TTL_MS + 1000)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('② 유휴 만료 직전에는 통과한다 — 경계', async () => {
    const { token } = await store.create()
    clock.advance(IDLE_TTL_MS - 1000)
    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })

  it('③ 절대 2시간을 넘기면 막는다 — 계속 활동해도', async () => {
    const { token } = await store.create()

    // 10분마다 활동하면 유휴 만료(15분)는 계속 밀린다.
    // 하지만 절대 만료는 안 밀리므로 2시간을 넘기는 순간 끊겨야 한다.
    const STEP_MS = 10 * 60 * 1000
    const steps = Math.ceil(ABSOLUTE_TTL_MS / STEP_MS) + 1

    for (let i = 0; i < steps; i++) {
      clock.advance(STEP_MS)
      await store.verifyAndTouch(token)
    }

    // 정말 2시간을 넘겼는지 먼저 확인한다 — 안 넘겼는데 통과하면 무의미한 테스트다
    expect(clock.now().getTime()).toBeGreaterThan(new Date(START).getTime() + ABSOLUTE_TTL_MS)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('④ revoke 하면 즉시 막는다 — 종료 버튼', async () => {
    const { token } = await store.create()
    expect(await store.verifyAndTouch(token)).not.toBeNull()
    await store.revoke(token)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })
})

describe('revoke', () => {
  it('없는 토큰을 revoke 해도 던지지 않는다 — sendBeacon 은 중복 도착할 수 있다', async () => {
    await expect(store.revoke('없는-토큰')).resolves.toBeUndefined()
  })

  it('두 번 revoke 해도 던지지 않는다 — 종료 버튼과 beacon 이 동시에 올 수 있다', async () => {
    const { token } = await store.create()
    await store.revoke(token)
    await expect(store.revoke(token)).resolves.toBeUndefined()
  })

  it('다른 세션을 건드리지 않는다', async () => {
    const a = await store.create()
    const b = await store.create()
    await store.revoke(a.token)
    expect(await store.verifyAndTouch(a.token)).toBeNull()
    expect(await store.verifyAndTouch(b.token)).not.toBeNull()
  })
})

describe('hashToken', () => {
  it('같은 입력에 같은 해시를 준다', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('다른 입력에 다른 해시를 준다', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})
