import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import {
  ensureTodayPlan, readPlan, recordItemResult, completePlanIfDone,
  markStudying, saveAnswers,
} from '../../lib/plan/store'
import { loadSettings } from '../../lib/settings/store'
import { applyManualScore } from '../../lib/mastery/apply'
import { dailyPlans, planItems, topicProgress, users } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z') // KST 2026-09-01
})
afterEach(async () => { await close() })

describe('설정', () => {
  it('없으면 기본값을 만들어 준다 — 90일 · 하루 60분', async () => {
    expect(await loadSettings(db)).toMatchObject({ targetDayCount: 90, dailyStudyMinutes: 60 })
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('있으면 그것을 쓴다', async () => {
    await db.insert(users).values({ targetDayCount: 30, dailyStudyMinutes: 25 })
    expect(await loadSettings(db)).toMatchObject({ targetDayCount: 30, dailyStudyMinutes: 25 })
  })
})

describe('오늘의 계획', () => {
  it('첫 호출에 계획을 만든다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)

    expect(plan.dayNumber).toBe(1)
    expect(plan.studyDate).toBe('2026-09-01')
    expect(plan.items.length).toBeGreaterThan(0)
  })

  it('★ 두 번 불러도 같은 계획이다 — 새로고침이 하루를 다시 짜지 않는다', async () => {
    const first = await ensureTodayPlan(db, clock, 20)
    const second = await ensureTodayPlan(db, clock, 20)

    expect(second.id).toBe(first.id)
    expect(second.items.map((i) => i.topicId)).toEqual(first.items.map((i) => i.topicId))
    expect(await db.select().from(dailyPlans)).toHaveLength(1)
  })

  it('★ 예산이 줄어도 이미 만든 계획을 다시 짜지 않는다', async () => {
    const first = await ensureTodayPlan(db, clock, 20)
    const again = await ensureTodayPlan(db, clock, 1) // 예산이 바닥났다

    expect(again.items).toHaveLength(first.items.length)
  })

  it('날짜가 바뀌면 새 계획을 만들고 Day 번호가 오른다', async () => {
    await ensureTodayPlan(db, clock, 20)
    clock.advance(24 * 60 * 60 * 1000)

    const second = await ensureTodayPlan(db, clock, 20)
    expect(second.dayNumber).toBe(2)
    expect(second.studyDate).toBe('2026-09-02')
  })

  it('예상 호출 수를 계획에 적어둔다 — 학습 시작 전에 보인다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    expect(plan.estimatedCalls).toBe(plan.items.length + 1)
  })

  it('★ 예산이 3이면 항목 2개다', async () => {
    const plan = await ensureTodayPlan(db, clock, 3)
    expect(plan.items).toHaveLength(2)
    expect(plan.estimatedCalls).toBe(3)
  })

  it('항목이 우선순위 순으로 나온다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    const ps = plan.items.map((i) => i.priority)
    expect([...ps].sort((a, b) => b - a)).toEqual(ps)
  })
})

describe('★ 결과가 다음 날 계획을 바꾼다', () => {
  it('잘하면 그 Topic 이 내일 안 나온다', async () => {
    const day1 = await ensureTodayPlan(db, clock, 20)
    const first = day1.items[0].topicId

    await applyManualScore(db, clock, first, 95)

    clock.advance(24 * 60 * 60 * 1000)
    const day2 = await ensureTodayPlan(db, clock, 20)

    // 95점이면 복습이 1일 뒤이므로 내일은 복습으로 나올 수 있다.
    // 신규로는 나오지 않아야 한다.
    const item = day2.items.find((i) => i.topicId === first)
    if (item) expect(item.kind).toBe('review')
  })

  it('★ 못하면 그 Topic 이 내일도 나온다', async () => {
    const day1 = await ensureTodayPlan(db, clock, 20)
    const first = day1.items[0].topicId

    await applyManualScore(db, clock, first, 20)

    clock.advance(24 * 60 * 60 * 1000)
    const day2 = await ensureTodayPlan(db, clock, 20)

    expect(day2.items.map((i) => i.topicId)).toContain(first)
  })

  it('★ 잘하면 후속 Topic 이 열린다', async () => {
    // 시간을 넉넉히 준다. 60분이면 3개만 들어가서 후속이 밀릴 수 있고,
    // 그러면 "열렸는가"가 아니라 "오늘 담겼는가"를 보게 된다.
    await db.insert(users).values({ dailyStudyMinutes: 300 })
    await applyManualScore(db, clock, 'cs.prog.variables-types', 95)

    const plan = await ensureTodayPlan(db, clock, 30)
    expect(plan.items.map((i) => i.topicId)).toContain('cs.prog.control-flow')
  })

  it('★ 못하면 후속 Topic 이 안 열린다 — 시간이 남아돌아도', async () => {
    await db.insert(users).values({ dailyStudyMinutes: 300 })
    await applyManualScore(db, clock, 'cs.prog.variables-types', 20)

    const plan = await ensureTodayPlan(db, clock, 30)
    expect(plan.items.map((i) => i.topicId)).not.toContain('cs.prog.control-flow')
  })

  it('숙련도가 DB 에 남는다', async () => {
    await applyManualScore(db, clock, 'cs.ds.array', 85)

    const [row] = await db.select().from(topicProgress)
      .where(eq(topicProgress.topicId, 'cs.ds.array'))
    expect(row.status).toBe('mastered')
    expect(row.masteryScore).toBeGreaterThan(80)
    expect(row.nextReviewAt).not.toBeNull()
    expect(row.attemptCount).toBe(1)
  })

  it('★ 한 번의 실수로 숙달이 무너지지 않는다', async () => {
    await applyManualScore(db, clock, 'cs.ds.array', 95)
    const after = await applyManualScore(db, clock, 'cs.ds.array', 0)

    expect(after.score).toBeGreaterThan(0)
    expect(after.previousScore).toBeGreaterThan(90)
  })

  it('틀린 횟수를 센다', async () => {
    await applyManualScore(db, clock, 'cs.ds.array', 20)
    await applyManualScore(db, clock, 'cs.ds.array', 20)

    const [row] = await db.select().from(topicProgress)
      .where(eq(topicProgress.topicId, 'cs.ds.array'))
    expect(row.wrongCount).toBe(2)
    expect(row.attemptCount).toBe(2)
  })

  it('없는 Topic 에는 점수를 넣을 수 없다', async () => {
    await expect(applyManualScore(db, clock, 'cs.없는.토픽', 80)).rejects.toThrow(/없는 Topic/)
  })
})

describe('계획 항목의 결과 기록', () => {
  it('점수를 항목에 남기고 상태를 done 으로 바꾼다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    const topicId = plan.items[0].topicId

    await recordItemResult(db, plan.id, topicId, { attemptNo: 1, score: 80 })

    const [item] = await db.select().from(planItems).where(eq(planItems.topicId, topicId))
    expect(item.status).toBe('done')
    expect(item.score).toBe(80)
    expect(item.attemptNo).toBe(1)
  })

  it('★ 전부 끝나야 계획이 완료된다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)

    for (const [i, item] of plan.items.entries()) {
      const done = await completePlanIfDone(db, clock, plan.id)
      expect(done, `${i}번째에서 완료되면 안 된다`).toBe(false)
      await recordItemResult(db, plan.id, item.topicId, { attemptNo: 1, score: 80 })
    }

    expect(await completePlanIfDone(db, clock, plan.id)).toBe(true)

    const after = await readPlan(db, '2026-09-01')
    expect(after!.status).toBe('completed')
  })
})

describe('답안 저장', () => {
  it('★ pending 항목에도 답을 저장한다 — 자료가 이미 있으면 pending 에 머문다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    const item = plan.items[0]!
    expect(item.status).toBe('pending')

    await saveAnswers(db, plan.id, item.topicId, { q1: '내 답' })

    const after = (await readPlan(db, plan.studyDate))!
    const saved = after.items.find((i) => i.topicId === item.topicId)!
    expect(saved.answers).toEqual({ q1: '내 답' })
    expect(saved.status).toBe('studying')
  })

  it('★ 채점이 끝난 항목의 답은 덮어쓰지 않는다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    const item = plan.items[0]!

    await saveAnswers(db, plan.id, item.topicId, { q1: '원래 답' })
    await recordItemResult(db, plan.id, item.topicId, {
      attemptNo: 1, answers: { q1: '원래 답' }, score: 80,
    })
    await saveAnswers(db, plan.id, item.topicId, { q1: '나중 답' })

    const after = (await readPlan(db, plan.studyDate))!
    const saved = after.items.find((i) => i.topicId === item.topicId)!
    expect(saved.answers).toEqual({ q1: '원래 답' })
    expect(saved.status).toBe('done')
  })

  it('markStudying 은 이미 끝난 항목을 되돌리지 않는다', async () => {
    const plan = await ensureTodayPlan(db, clock, 20)
    const item = plan.items[0]!

    await recordItemResult(db, plan.id, item.topicId, { attemptNo: 1, score: 80 })
    await markStudying(db, plan.id, item.topicId)

    const after = (await readPlan(db, plan.studyDate))!
    expect(after.items.find((i) => i.topicId === item.topicId)!.status).toBe('done')
  })
})
