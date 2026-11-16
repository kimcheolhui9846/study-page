import { eq } from 'drizzle-orm'
import { aiRequests } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'

/**
 * 자유학습의 멱등성 (비용 방어 ②겹의 자유학습 자리).
 *
 * 화면이 전송마다 UUID 를 만든다. 같은 전송의 재시도(네트워크 끊김, 연타)는
 * 같은 ID 를 쓰고, 「다른 문제 만들어 줘」 같은 새 요청은 새 ID 를 쓴다.
 *
 * 판정은 INSERT … ON CONFLICT DO NOTHING 한 문장이다. 읽고-판단하고-쓰기로
 * 나누면 동시에 온 두 요청이 둘 다 「처음」이라고 판단한다.
 */

export type Claim =
  | { kind: 'new' }
  | { kind: 'done'; result: unknown }
  | { kind: 'failed'; errorCode: string }
  | { kind: 'pending' }
  /** 같은 ID 가 다른 행동이나 다른 세션에 쓰였다 — 다른 요청의 결과를 돌려주지 않는다 */
  | { kind: 'mismatch' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isRequestId(x: unknown): x is string {
  return typeof x === 'string' && UUID.test(x)
}

export async function claimRequest(db: Db, clock: Clock, i: {
  requestId: string; action: string; sessionId: number | null
}): Promise<Claim> {
  const inserted = await db.insert(aiRequests).values({
    requestId: i.requestId, action: i.action, sessionId: i.sessionId,
    status: 'pending', createdAt: clock.now(),
  }).onConflictDoNothing().returning({ id: aiRequests.requestId })
  if (inserted.length > 0) return { kind: 'new' }

  const [row] = await db.select().from(aiRequests).where(eq(aiRequests.requestId, i.requestId))
  if (!row) return { kind: 'pending' } // 지워지지 않으므로 오지 않는다. 안전한 쪽으로
  if (row.action !== i.action || row.sessionId !== i.sessionId) return { kind: 'mismatch' }
  if (row.status === 'done') return { kind: 'done', result: row.result }
  if (row.status === 'failed') return { kind: 'failed', errorCode: row.errorCode ?? 'GENERATION_FAILED' }
  return { kind: 'pending' }
}

export async function finishRequest(db: Db, clock: Clock, requestId: string, result: unknown): Promise<void> {
  await db.update(aiRequests)
    .set({ status: 'done', result, finishedAt: clock.now() })
    .where(eq(aiRequests.requestId, requestId))
}

export async function failRequest(db: Db, clock: Clock, requestId: string, errorCode: string): Promise<void> {
  await db.update(aiRequests)
    .set({ status: 'failed', errorCode, finishedAt: clock.now() })
    .where(eq(aiRequests.requestId, requestId))
}
