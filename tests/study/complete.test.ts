import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { completeDay } from '../../lib/study/complete'
import { studyDays } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')
  await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01',
    content: { passage: { title: 't' }, questions: [] },
  })
})
afterEach(async () => { await close() })

const day = async () => (await db.select().from(studyDays)
  .where(eq(studyDays.subject, 'cs')))[0]

describe('completeDay', () => {
  it('status 를 completed 로 바꾸고 완료 시각을 남긴다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const d = await day()
    expect(d.status).toBe('completed')
    expect(d.completedAt).not.toBeNull()
  })

  it('★ 채점 이의 제기를 기록한다 — LLM 을 다시 부르지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, true)
    const d = await day()
    expect(d.status).toBe('completed')
    expect((d.content as { grading_disputed?: boolean }).grading_disputed).toBe(true)
  })

  it('이의 제기 기록이 기존 콘텐츠를 지우지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, true)
    const d = await day()
    expect((d.content as { passage?: { title?: string } }).passage?.title).toBe('t')
  })

  it('이의 제기가 아니면 플래그를 남기지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const d = await day()
    expect((d.content as { grading_disputed?: boolean }).grading_disputed).toBeUndefined()
  })

  /**
   * ★ 새로고침으로 두 번 눌릴 수 있다. 그때 완료 시각이 밀리면
   * "언제 마쳤나"라는 기록이 거짓말이 된다.
   */
  it('★ 두 번 불러도 처음 완료 시각을 덮어쓰지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const first = (await day()).completedAt

    clock.advance(60_000)
    await completeDay(db, clock, 'cs', 1, false)

    expect((await day()).completedAt).toEqual(first)
  })

  it('없는 Day 는 조용히 넘어간다', async () => {
    await expect(completeDay(db, clock, 'cs', 99, false)).resolves.toBeUndefined()
  })

  it('다른 과목을 건드리지 않는다', async () => {
    await db.insert(studyDays).values({
      subject: 'math', dayNo: 1, studyDate: '2026-09-01', content: {},
    })
    await completeDay(db, clock, 'cs', 1, false)

    const [m] = await db.select().from(studyDays).where(eq(studyDays.subject, 'math'))
    expect(m.status).toBe('in_progress')
  })
})
