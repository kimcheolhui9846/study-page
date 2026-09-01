import { randomBytes, createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { sessions } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import {
  ABSOLUTE_TTL_MS, IDLE_TTL_MS,
  type Session, type SessionStore,
} from './store'

/** 원본 토큰은 DB에 저장하지 않는다. DB가 유출돼도 세션을 위조할 수 없다. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: Db, private readonly clock: Clock) {}

  async create(): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS)

    await this.db.insert(sessions).values({
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      expiresAt,
    })

    return { token, expiresAt }
  }

  /**
   * 검증과 갱신을 한 문장으로 한다.
   *
   * 읽고-판단하고-쓰기로 나누면 그 사이에 만료되거나 revoke 될 수 있다.
   * UPDATE ... WHERE (조건 4개) ... RETURNING 이면 조건을 만족할 때만 갱신되고
   * 만족하지 않으면 0행이 돌아온다 — 검증과 갱신이 원자적으로 묶인다.
   */
  async verifyAndTouch(token: string): Promise<Session | null> {
    const now = this.clock.now()

    const rows = await this.db
      .update(sessions)
      .set({
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      })
      .where(and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),          // ④ 종료 버튼 / beacon
        gt(sessions.expiresAt, now),         // ③ 절대 만료 — 밀리지 않는다
        gt(sessions.idleExpiresAt, now),     // ② 유휴 만료
      ))
      .returning()

    const row = rows[0]
    if (!row) return null                    // ① 없는 토큰도 여기로 온다

    return {
      tokenHash: row.tokenHash,
      createdAt: row.createdAt,
      idleExpiresAt: row.idleExpiresAt,
      expiresAt: row.expiresAt,
    }
  }

  /** 멱등하다. 없는 토큰이든 이미 revoke 된 토큰이든 조용히 성공한다. */
  /**
   * 유휴 만료를 앞당긴다 (pagehide 유예).
   *
   * WHERE 에 `idleExpiresAt > soon` 을 넣어 **당기기만 하고 늘리지 않는다.**
   * 이게 없으면 만료 20초 전에 도착한 beacon 이 오히려 30초로 되돌려
   * 세션을 연장해 준다 — 종료 신호가 연장 신호가 되는 셈이다.
   */
  async expireSoon(token: string, withinMs: number): Promise<void> {
    const soon = new Date(this.clock.now().getTime() + withinMs)
    await this.db
      .update(sessions)
      .set({ idleExpiresAt: soon })
      .where(and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, soon),
      ))
  }

  async revoke(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.clock.now() })
      .where(eq(sessions.tokenHash, hashToken(token)))
  }
}
