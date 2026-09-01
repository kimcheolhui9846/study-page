import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { readHint } from '../../lib/study/hint'
import { studyDays } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01',
    content: {
      passage: { title: 't', body_md: 'b', key_terms: [] },
      questions: [
        { id: 'q1', type: 'recall', prompt: 'p', expected_points: ['비밀 루브릭'], hint: '첫 힌트' },
        { id: 'q2', type: 'concept', prompt: 'p', expected_points: ['비밀'], hint: '둘째 힌트' },
      ],
    },
  })
})
afterEach(async () => { await close() })

describe('힌트', () => {
  it('DB 에 저장된 힌트를 준다 — LLM 을 부르지 않는다', async () => {
    expect(await readHint(db, 'cs', 1, 'q2')).toBe('둘째 힌트')
  })

  it('★ 루브릭을 함께 흘리지 않는다', async () => {
    const hint = await readHint(db, 'cs', 1, 'q1')
    expect(hint).toBe('첫 힌트')
    expect(hint).not.toContain('비밀')
  })

  it('없는 문제는 null 이다', async () => {
    expect(await readHint(db, 'cs', 1, 'q9')).toBeNull()
  })

  it('없는 Day 는 null 이다', async () => {
    expect(await readHint(db, 'cs', 99, 'q1')).toBeNull()
  })
})
