import { and, eq, gte, sql } from 'drizzle-orm'
import { loginAttempts } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT_THRESHOLD = 5

/**
 * 최근 창 안의 실패 횟수로 잠금을 판정한다.
 *
 * 사용자가 1명이므로 IP 별이 아니라 전역으로 센다 — IP 를 바꿔가며 시도해도 막힌다.
 * 로그인 자체는 돈이 들지 않지만, 뚫리면 세션 게이트가 통째로 무의미해진다.
 */
export async function isLockedOut(db: Db, clock: Clock): Promise<boolean> {
  const since = new Date(clock.now().getTime() - LOCKOUT_WINDOW_MS)

  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(
      eq(loginAttempts.succeeded, false),
      gte(loginAttempts.attemptedAt, since),
    ))

  return (rows[0]?.n ?? 0) >= LOCKOUT_THRESHOLD
}

export async function recordAttempt(
  db: Db, clock: Clock, succeeded: boolean, ip: string | null,
): Promise<void> {
  await db.insert(loginAttempts).values({
    attemptedAt: clock.now(),
    ip,
    succeeded,
  })
}
