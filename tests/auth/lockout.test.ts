import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import {
  isLockedOut, recordAttempt, LOCKOUT_THRESHOLD, LOCKOUT_WINDOW_MS,
} from '../../lib/auth/lockout'
import { loginAttempts } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
})
afterEach(async () => { await close() })

async function fail(n: number) {
  for (let i = 0; i < n; i++) await recordAttempt(db, clock, false, '1.2.3.4')
}

describe('isLockedOut', () => {
  it('실패가 없으면 잠기지 않는다', async () => {
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('임계값 직전까지는 잠기지 않는다', async () => {
    await fail(LOCKOUT_THRESHOLD - 1)
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('임계값에 도달하면 잠긴다', async () => {
    await fail(LOCKOUT_THRESHOLD)
    expect(await isLockedOut(db, clock)).toBe(true)
  })

  it('창 밖의 실패는 세지 않는다 — 15분 뒤 자동 해제', async () => {
    await fail(LOCKOUT_THRESHOLD)
    expect(await isLockedOut(db, clock)).toBe(true)

    clock.advance(LOCKOUT_WINDOW_MS + 1000)
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('창 경계 직전의 실패는 아직 센다', async () => {
    await fail(LOCKOUT_THRESHOLD)
    clock.advance(LOCKOUT_WINDOW_MS - 1000)
    expect(await isLockedOut(db, clock)).toBe(true)
  })

  it('성공한 시도는 잠금에 세지 않는다', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD + 3; i++) {
      await recordAttempt(db, clock, true, '1.2.3.4')
    }
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('IP 를 바꿔도 잠긴다 — 사용자가 1명이라 전역으로 센다', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await recordAttempt(db, clock, false, `10.0.0.${i}`)
    }
    expect(await isLockedOut(db, clock)).toBe(true)
  })
})

describe('recordAttempt', () => {
  it('시도를 기록한다', async () => {
    await recordAttempt(db, clock, false, '1.2.3.4')
    const rows = await db.select().from(loginAttempts)
    expect(rows).toHaveLength(1)
    expect(rows[0].succeeded).toBe(false)
    expect(rows[0].ip).toBe('1.2.3.4')
  })

  it('IP 를 모를 때 null 을 받는다', async () => {
    await recordAttempt(db, clock, true, null)
    const rows = await db.select().from(loginAttempts)
    expect(rows[0].ip).toBeNull()
  })

  it('주입된 시각으로 기록한다 — 서버 시각이 아니라', async () => {
    clock.advance(60_000)
    await recordAttempt(db, clock, false, null)
    const rows = await db.select().from(loginAttempts)
    expect(rows[0].attemptedAt.toISOString()).toBe('2026-09-01T00:01:00.000Z')
  })
})
