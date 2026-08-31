import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore } from '../../lib/session/postgres'
import { makeGuard, readSidCookie } from '../../lib/session/guard'
import { IDLE_TTL_MS } from '../../lib/session/store'
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

function reqWithToken(token: string | null): Request {
  const headers = new Headers()
  if (token) headers.set('cookie', `theme=dark; sid=${token}; other=1`)
  return new Request('http://localhost/api/protected', { method: 'POST', headers })
}

const okHandler = async () => new Response('통과', { status: 200 })

/** 동적 세그먼트가 없는 라우트의 컨텍스트 */
const noCtx = { params: Promise.resolve({}) }

describe('readSidCookie', () => {
  it('여러 쿠키 중 sid 만 꺼낸다', () => {
    expect(readSidCookie(reqWithToken('abc123'))).toBe('abc123')
  })

  it('쿠키 헤더가 없으면 null', () => {
    expect(readSidCookie(reqWithToken(null))).toBeNull()
  })

  it('sid 가 없으면 null', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'theme=dark' } })
    expect(readSidCookie(req)).toBeNull()
  })

  it('이름이 sid 로 끝나는 다른 쿠키를 sid 로 착각하지 않는다', () => {
    // 쿠키 헤더는 ByteString 이라 ASCII 만 담을 수 있다
    const req = new Request('http://localhost/', { headers: { cookie: 'not_sid=decoy' } })
    expect(readSidCookie(req)).toBeNull()
  })

  it('앞뒤 다른 쿠키에 섞여 있어도 sid 만 정확히 꺼낸다', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: 'not_sid=decoy; sid=real; sid_extra=other' },
    })
    expect(readSidCookie(req)).toBe('real')
  })

  it('base64url 토큰의 = 를 잘라먹지 않는다', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'sid=a=b=c' } })
    expect(readSidCookie(req)).toBe('a=b=c')
  })
})

describe('가드', () => {
  it('유효한 세션은 핸들러까지 도달한다', async () => {
    const { token } = await store.create()
    const res = await makeGuard(store)(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(200)
  })

  it('쿠키가 없으면 401 이고 핸들러가 실행되지 않는다', async () => {
    let ran = false
    const res = await makeGuard(store)(async () => {
      ran = true
      return new Response('')
    })(reqWithToken(null), noCtx)

    expect(res.status).toBe(401)
    expect(ran).toBe(false)
  })

  it('유휴 만료된 세션은 401 이고 죽은 쿠키를 지운다', async () => {
    const { token } = await store.create()
    clock.advance(IDLE_TTL_MS + 1000)

    const res = await makeGuard(store)(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain('sid=')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('revoke 된 세션은 401 — 종료 버튼 뒤에는 통과하지 못한다', async () => {
    const { token } = await store.create()
    await store.revoke(token)
    const res = await makeGuard(store)(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(401)
  })

  it('401 본문이 JSON 이다 — 클라이언트가 사유를 구분할 수 있어야 한다', async () => {
    const res = await makeGuard(store)(okHandler)(reqWithToken(null), noCtx)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).error).toBe('SESSION_EXPIRED')
  })

  it('핸들러에 세션을 넘긴다', async () => {
    const { token } = await store.create()
    const res = await makeGuard(store)(async (_req, session) =>
      Response.json({ expiresAt: session.expiresAt.toISOString() }),
    )(reqWithToken(token), noCtx)

    expect(res.status).toBe(200)
    expect((await res.json()).expiresAt).toBe('2026-09-01T02:00:00.000Z')
  })

  it('핸들러에 라우트 컨텍스트를 그대로 넘긴다 — Next 16 의 params 는 Promise 다', async () => {
    const { token } = await store.create()
    const ctx = { params: Promise.resolve({ subject: 'cs' }) }

    const res = await makeGuard(store)<{ subject: string }>(async (_req, _session, c) => {
      const { subject } = await c.params
      return Response.json({ subject })
    })(reqWithToken(token), ctx)

    expect((await res.json()).subject).toBe('cs')
  })

  it('통과할 때 유휴 만료를 민다', async () => {
    const { token } = await store.create()
    clock.advance(10 * 60 * 1000)
    await makeGuard(store)(okHandler)(reqWithToken(token), noCtx)

    clock.advance(10 * 60 * 1000) // 시작으로부터 20분. 밀렸으면 아직 살아있다
    const res = await makeGuard(store)(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(200)
  })
})
