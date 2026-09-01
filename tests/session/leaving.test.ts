import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore } from '../../lib/session/postgres'
import { LEAVING_GRACE_MS, IDLE_TTL_MS } from '../../lib/session/store'
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

/**
 * 탭이 사라질 때의 유예.
 *
 * 브라우저는 "창을 닫았다"와 "새로고침했다"를 구분해 주지 않는다 —
 * pagehide 는 둘 다에서 똑같이 발생한다. 즉시 파기하면 새로고침이
 * 곧 로그아웃이 된다. 실제로 그랬다.
 */
describe('pagehide 유예', () => {
  it('★ 새로고침은 살아남는다 — 유예 안에 요청이 오면 15분으로 되돌아간다', async () => {
    const { token } = await store.create()

    await store.expireSoon(token, LEAVING_GRACE_MS) // pagehide
    clock.advance(1_000)                            // 새 페이지가 1초 만에 뜬다

    const session = await store.verifyAndTouch(token)
    expect(session).not.toBeNull()
    // 다시 15분이다. 유예가 흔적을 남기지 않는다.
    expect(session!.idleExpiresAt.getTime()).toBe(clock.now().getTime() + IDLE_TTL_MS)
  })

  it('★ 창을 닫으면 유예가 지난 뒤 죽는다', async () => {
    const { token } = await store.create()

    await store.expireSoon(token, LEAVING_GRACE_MS)
    clock.advance(LEAVING_GRACE_MS + 1_000) // 아무도 돌아오지 않았다

    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('유예 경계 직전에는 아직 살아 있다', async () => {
    const { token } = await store.create()
    await store.expireSoon(token, LEAVING_GRACE_MS)
    clock.advance(LEAVING_GRACE_MS - 1_000)

    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })

  /**
   * ★ 이게 없으면 종료 신호가 연장 신호가 된다.
   *
   * 만료 10초 전에 도착한 beacon 이 유휴 만료를 30초로 "당기면"
   * 실제로는 20초를 늘려주는 것이다.
   */
  it('이미 더 이른 만료가 걸려 있으면 늘리지 않는다', async () => {
    const { token } = await store.create()

    await store.expireSoon(token, 10_000)                 // 10초 뒤 만료
    await store.expireSoon(token, LEAVING_GRACE_MS)       // 30초로 늘리려는 시도

    clock.advance(11_000)
    expect(await store.verifyAndTouch(token)).toBeNull()  // 10초 기준이 지켜졌다
  })

  it('절대 만료를 넘겨 연장하지 않는다', async () => {
    const { token } = await store.create()
    clock.advance(2 * 60 * 60 * 1000 + 1_000) // 절대 2시간 초과

    await store.expireSoon(token, LEAVING_GRACE_MS)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('이미 종료된 세션에는 아무 일도 하지 않는다', async () => {
    const { token } = await store.create()
    await store.revoke(token)

    await store.expireSoon(token, LEAVING_GRACE_MS) // 던지지 않는다
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('없는 토큰이어도 조용히 성공한다 — beacon 은 중복 도착할 수 있다', async () => {
    await expect(store.expireSoon('없는-토큰', LEAVING_GRACE_MS)).resolves.toBeUndefined()
  })

  it('beacon 이 두 번 와도 결과가 같다', async () => {
    const { token } = await store.create()
    await store.expireSoon(token, LEAVING_GRACE_MS)
    await store.expireSoon(token, LEAVING_GRACE_MS)

    clock.advance(LEAVING_GRACE_MS - 1_000)
    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })
})
