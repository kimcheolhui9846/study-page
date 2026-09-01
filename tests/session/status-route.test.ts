import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore } from '../../lib/session/postgres'
import { makeGuard } from '../../lib/session/guard'
import { sessionStatusHandler } from '../../lib/session/status'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let store: PostgresSessionStore

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
  store = new PostgresSessionStore(db, clock)
})
afterEach(async () => { await close() })

/** 가드를 통과시켜 상태 핸들러를 부른다. 라우트가 하는 일과 같다. */
function call(token?: string): Promise<Response> {
  const req = new Request('http://localhost/api/session/status', {
    headers: token ? { cookie: `sid=${token}` } : {},
  })
  return makeGuard(store)(sessionStatusHandler)(req, { params: Promise.resolve({}) })
}

describe('세션 상태', () => {
  it('두 만료 시각을 준다', async () => {
    const { token } = await store.create()
    const body = await (await call(token)).json()

    expect(body.expiresAt).toBe('2026-09-01T02:00:00.000Z')     // 절대 2시간
    expect(body.idleExpiresAt).toBe('2026-09-01T00:15:00.000Z') // 유휴 15분
  })

  it('세션이 없으면 401 이다 — 카운트다운을 그릴 근거가 없다', async () => {
    expect((await call()).status).toBe(401)
  })

  it('만료된 세션도 401 이다', async () => {
    const { token } = await store.create()
    clock.advance(16 * 60 * 1000) // 유휴 15분 초과
    expect((await call(token)).status).toBe(401)
  })

  /**
   * ★ 이 테스트가 없으면 상태 조회가 하트비트가 된다.
   *
   * 가드는 통과할 때마다 유휴 만료를 민다. 세션 바가 이 라우트를 1초마다
   * 부르면 유휴 타임아웃이 영원히 오지 않는다 — 넣지 않기로 한 하트비트를
   * 뒷문으로 들이는 셈이다. 그래서 세션 바는 이걸 마운트 때 한 번만 부른다.
   *
   * 이 테스트는 "라우트가 시각을 민다"는 사실 자체를 못박아 둔다.
   * 이 사실을 잊고 폴링을 붙이면 유휴 만료가 사라진다.
   */
  it('상태 조회도 유휴 만료를 민다 — 그래서 폴링하면 안 된다', async () => {
    const { token } = await store.create()

    clock.advance(10 * 60 * 1000)
    const body = await (await call(token)).json()

    // 조회 시점 기준으로 15분 뒤로 밀렸다. 만들었을 때의 00:15 가 아니다.
    expect(body.idleExpiresAt).toBe('2026-09-01T00:25:00.000Z')
    // 절대 만료는 밀리지 않는다.
    expect(body.expiresAt).toBe('2026-09-01T02:00:00.000Z')
  })
})
