import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import {
  studySessions, studyMaterials, studyProblems, studySubmissions,
  topicContents, usageLedger,
} from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function session(): Promise<number> {
  const [row] = await db.insert(studySessions)
    .values({ studyMode: 'math', title: 't', request: 'r' })
    .returning({ id: studySessions.id })
  return row.id
}

async function material(sessionId: number, version: number): Promise<number> {
  const [row] = await db.insert(studyMaterials).values({
    sessionId, version, activity: 'concept', content: {}, requestId: `req-${version}`,
  }).returning({ id: studyMaterials.id })
  return row.id
}

describe('자유학습 테이블 (마이그레이션 0001)', () => {
  it('모르는 study_mode 를 거절한다', async () => {
    await expect(db.insert(studySessions)
      .values({ studyMode: 'physics', title: 't', request: 'r' })).rejects.toThrow()
  })

  it('★ 같은 세션에 같은 자료 버전이 두 번 들어가지 않는다', async () => {
    const s = await session()
    await material(s, 1)
    await expect(material(s, 1)).rejects.toThrow()
  })

  it('★ 같은 세션에 같은 문제 번호가 두 번 들어가지 않는다', async () => {
    const s = await session()
    const m = await material(s, 1)
    const row = { sessionId: s, materialId: m, number: 1, public: {}, private: {} }
    await db.insert(studyProblems).values(row)
    await expect(db.insert(studyProblems).values(row)).rejects.toThrow()
  })

  it('힌트 공개 단계는 0..3 이다', async () => {
    const s = await session()
    const m = await material(s, 1)
    await expect(db.insert(studyProblems).values({
      sessionId: s, materialId: m, number: 1, public: {}, private: {}, hintsRevealed: 4,
    })).rejects.toThrow()
  })

  it('제출 시도 번호는 1..20 이다', async () => {
    const s = await session()
    const m = await material(s, 1)
    const [p] = await db.insert(studyProblems)
      .values({ sessionId: s, materialId: m, number: 1, public: {}, private: {} })
      .returning({ id: studyProblems.id })
    await expect(db.insert(studySubmissions).values({
      problemId: p.id, attemptNo: 21, answer: 'a', feedbackMode: 'full',
      feedback: {}, verdict: 'correct', requestId: 'x',
    })).rejects.toThrow()
  })

  it('★ 기존 원장 행은 새 컬럼 없이 그대로 들어가고 읽힌다', async () => {
    await db.insert(usageLedger).values({
      route: 'content', subject: 'cs', model: 'gpt-4o-mini', costMicros: 10, ok: true,
    })
    const rows = await db.select().from(usageLedger)
    expect(rows).toHaveLength(1)
    expect(rows[0].requestId).toBeNull()
    expect(rows[0].studySessionId).toBeNull()
  })

  it('★ 기존 커리큘럼 테이블은 그대로다', async () => {
    await db.insert(topicContents).values({ topicId: 'cs.x', content: { a: 1 }, model: 'gpt-4o-mini' })
    const rows = await db.select().from(topicContents)
    expect(rows[0].content).toEqual({ a: 1 })
  })

  it('★ 마이그레이션 0001 은 지우거나 타입을 바꾸지 않는다', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const file = readdirSync('drizzle').find((f) => f.startsWith('0001_'))
    expect(file).toBeDefined()
    const text = readFileSync(`drizzle/${file}`, 'utf8')
    expect(text).not.toMatch(/DROP\s/i)
    expect(text).not.toMatch(/ALTER COLUMN/i)
    expect(text).not.toMatch(/SET DATA TYPE/i)
    // 실제로 DB 가 받아들이는지
    const r = await db.execute(sql`select count(*)::int as n from study_sessions`)
    expect(r).toBeDefined()
  })
})
