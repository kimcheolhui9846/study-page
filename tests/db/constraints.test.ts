import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { studyDays, attempts, summaries } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function insertDay(dayNo: number, studyDate: string, subject = 'cs') {
  const [row] = await db.insert(studyDays)
    .values({ subject, dayNo, studyDate, content: {} })
    .returning({ id: studyDays.id })
  return row.id
}

describe('study_days 제약', () => {
  it('같은 (subject, day_no) 를 두 번 넣을 수 없다 — 콘텐츠 재생성 차단', async () => {
    await insertDay(1, '2026-09-01')
    await expect(insertDay(1, '2026-09-02')).rejects.toThrow()
  })

  it('같은 과목을 하루에 두 Day 진행할 수 없다 — 당일 추가 생성 차단', async () => {
    await insertDay(1, '2026-09-01')
    await expect(insertDay(2, '2026-09-01')).rejects.toThrow()
  })

  it('다른 과목은 같은 날 진행할 수 있다', async () => {
    await insertDay(1, '2026-09-01', 'cs')
    await insertDay(1, '2026-09-01', 'math')
    expect(await db.select().from(studyDays)).toHaveLength(2)
  })

  it('같은 과목의 다음 Day 는 다른 날 진행할 수 있다', async () => {
    await insertDay(1, '2026-09-01')
    await insertDay(2, '2026-09-02')
    expect(await db.select().from(studyDays)).toHaveLength(2)
  })

  it('정의되지 않은 status 를 넣을 수 없다', async () => {
    await expect(
      db.insert(studyDays).values({
        subject: 'cs', dayNo: 9, studyDate: '2026-09-09', content: {}, status: 'paused',
      }),
    ).rejects.toThrow()
  })

  it('정의된 status 셋은 전부 허용된다', async () => {
    await db.insert(studyDays).values({ subject: 'cs', dayNo: 1, studyDate: '2026-09-01', content: {}, status: 'in_progress' })
    await db.insert(studyDays).values({ subject: 'cs', dayNo: 2, studyDate: '2026-09-02', content: {}, status: 'completed' })
    await db.insert(studyDays).values({ subject: 'cs', dayNo: 3, studyDate: '2026-09-03', content: {}, status: 'abandoned' })
    expect(await db.select().from(studyDays)).toHaveLength(3)
  })
})

describe('attempts 제약', () => {
  it('채점 3회차를 넣을 수 없다 — 재시도 상한 2회', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} })
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 2, answers: {} })
    await expect(
      db.insert(attempts).values({ studyDayId: id, attemptNo: 3, answers: {} }),
    ).rejects.toThrow()
  })

  it('같은 attempt_no 를 두 번 넣을 수 없다', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} })
    await expect(
      db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} }),
    ).rejects.toThrow()
  })

  it('study_day 가 지워지면 함께 지워진다', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} })
    await db.delete(studyDays)
    expect(await db.select().from(attempts)).toHaveLength(0)
  })
})

describe('summaries 제약', () => {
  it('polish_count 가 2를 넘을 수 없다 — 다듬기 상한', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(summaries).values({ studyDayId: id, rawText: '정리본', polishCount: 2 })
    await expect(db.update(summaries).set({ polishCount: 3 })).rejects.toThrow()
  })

  it('polish_count 는 0 으로 시작한다', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(summaries).values({ studyDayId: id, rawText: '정리본' })
    const [row] = await db.select().from(summaries)
    expect(row.polishCount).toBe(0)
  })

  it('한 study_day 에 정리본은 하나뿐이다', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(summaries).values({ studyDayId: id, rawText: '첫 번째' })
    await expect(
      db.insert(summaries).values({ studyDayId: id, rawText: '두 번째' }),
    ).rejects.toThrow()
  })
})
