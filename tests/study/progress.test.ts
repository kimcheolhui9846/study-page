import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { loadProgress, loadUsage } from '../../lib/study/progress'
import { reserve, recordUsage } from '../../lib/budget/reserve'
import { studyDays } from '../../lib/db/schema'
import { loadCurriculum } from '../../lib/curriculum/load'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z') // KST 2026-09-01 10:00
  vi.stubEnv('APP_ENV', 'local')
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const cs = () => loadProgress(db, clock).then((p) => p.find((x) => x.subject === 'cs')!)

async function insertDay(dayNo: number, studyDate: string, status = 'completed') {
  await db.insert(studyDays).values({
    subject: 'cs', dayNo, studyDate, status, content: {},
  })
}

describe('진도', () => {
  it('아무것도 안 했으면 Day 1 이다', async () => {
    const p = await cs()
    expect(p.dayNo).toBe(1)
    expect(p.today).toBe('none')
    expect(p.entry?.topic).toBe(loadCurriculum('cs').days[0].topic)
  })

  it('세 과목을 모두 준다', async () => {
    const all = await loadProgress(db, clock)
    expect(all.map((p) => p.subject)).toEqual(['english', 'math', 'cs'])
  })

  it('총 일수는 커리큘럼에서 온다 — 하드코딩이 아니다', async () => {
    const p = await cs()
    expect(p.totalDays).toBe(loadCurriculum('cs').days.length)
  })

  it('어제까지 Day 4 를 했으면 오늘은 Day 5 다', async () => {
    await insertDay(4, '2026-08-31')
    const p = await cs()
    expect(p.dayNo).toBe(5)
    expect(p.today).toBe('none') // 오늘 것은 아직 없다
  })

  it('오늘 연 Day 가 있으면 그것이 오늘의 Day 다', async () => {
    await insertDay(4, '2026-08-31')
    await insertDay(5, '2026-09-01', 'in_progress')
    const p = await cs()
    expect(p.dayNo).toBe(5)
    expect(p.today).toBe('in_progress')
  })

  it('오늘 마쳤으면 completed 다', async () => {
    await insertDay(5, '2026-09-01', 'completed')
    expect((await cs()).today).toBe('completed')
  })

  it('과목끼리 섞이지 않는다', async () => {
    await insertDay(4, '2026-08-31')
    const all = await loadProgress(db, clock)
    expect(all.find((p) => p.subject === 'cs')!.dayNo).toBe(5)
    expect(all.find((p) => p.subject === 'math')!.dayNo).toBe(1)
  })

  it('커리큘럼을 다 마치면 entry 가 null 이다 — 화면이 이걸 처리해야 한다', async () => {
    const total = loadCurriculum('cs').days.length
    await insertDay(total, '2026-08-31')
    const p = await cs()
    expect(p.dayNo).toBe(total + 1)
    expect(p.entry).toBeNull()
  })

  it('★ KST 기준으로 오늘을 판정한다 — UTC 가 아니라', async () => {
    // UTC 2026-09-01 15:30 = KST 2026-09-02 00:30. 날짜가 바뀐 뒤다.
    await insertDay(5, '2026-09-02', 'completed')
    const afterMidnight = fixedClock('2026-09-01T15:30:00Z')
    const [, , csP] = await loadProgress(db, afterMidnight)
    expect(csP.today).toBe('completed')
  })
})

describe('사용량', () => {
  it('아무 호출도 없으면 0 이고 캡은 환경값이다', async () => {
    const u = await loadUsage(db, clock)
    expect(u.dailyCalls).toBe(0)
    expect(u.dailyCap).toBe(3)
    expect(u.monthlyCostMicros).toBe(0)
    expect(u.monthlyCapMicros).toBe(500_000)
  })

  it('예약과 비용을 반영한다', async () => {
    await reserve(db, clock)
    await recordUsage(db, clock, {
      route: 'content', subject: 'cs', model: 'fake',
      promptTokens: 100, completionTokens: 100, costMicros: 840, ok: true,
    })

    const u = await loadUsage(db, clock)
    expect(u.dailyCalls).toBe(1)
    expect(u.monthlyCostMicros).toBe(840)
  })

  it('날짜가 바뀌면 일일 카운터가 다시 0 으로 보인다', async () => {
    await reserve(db, clock)
    expect((await loadUsage(db, clock)).dailyCalls).toBe(1)

    clock.advance(24 * 60 * 60 * 1000)
    expect((await loadUsage(db, clock)).dailyCalls).toBe(0)
  })
})
