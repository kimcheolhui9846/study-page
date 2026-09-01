import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import {
  topicContents, reviewItems, topicProgress, dailyPlans, planItems, users,
} from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

/**
 * 비용 방어선은 애플리케이션 조건문이 아니라 DB 제약이 지킨다.
 * 이 파일은 그 제약들이 실제로 거부하는지 확인한다.
 *
 * 1주차에는 같은 역할을 study_days · attempts · summaries 가 했다.
 * 적응형으로 옮기며 키가 Day 에서 Topic 으로 바뀌었을 뿐, 강도는 그대로다.
 */

let db: Db
let close: () => Promise<void>

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function makePlan(dayNumber = 1, studyDate = '2026-09-01') {
  const [row] = await db.insert(dailyPlans)
    .values({ dayNumber, studyDate, estimatedCalls: 3, estimatedMinutes: 60 })
    .returning({ id: dailyPlans.id })
  return row.id
}

describe('topic_contents — ②겹 멱등성', () => {
  it('★ 같은 Topic 의 콘텐츠를 두 번 만들 수 없다', async () => {
    await db.insert(topicContents)
      .values({ topicId: 'cs.os.process-thread', content: {}, model: 'gpt-4o-mini' })

    await expect(
      db.insert(topicContents)
        .values({ topicId: 'cs.os.process-thread', content: {}, model: 'gpt-4o-mini' }),
    ).rejects.toThrow()
  })

  it('다른 Topic 은 각자 만들 수 있다', async () => {
    await db.insert(topicContents)
      .values({ topicId: 'cs.os.process-thread', content: {}, model: 'gpt-4o-mini' })
    await expect(
      db.insert(topicContents)
        .values({ topicId: 'cs.ds.array', content: {}, model: 'gpt-4o-mini' }),
    ).resolves.toBeDefined()
  })
})

describe('review_items — 복습 생성 상한', () => {
  it('★ 회차 5를 넣을 수 없다 — Topic 당 복습은 최대 4회', async () => {
    await expect(
      db.insert(reviewItems).values({ topicId: 'cs.ds.array', round: 5, content: {} }),
    ).rejects.toThrow()
  })

  it('회차 0 도 넣을 수 없다', async () => {
    await expect(
      db.insert(reviewItems).values({ topicId: 'cs.ds.array', round: 0, content: {} }),
    ).rejects.toThrow()
  })

  it('★ 같은 회차를 두 번 만들 수 없다', async () => {
    await db.insert(reviewItems).values({ topicId: 'cs.ds.array', round: 1, content: {} })
    await expect(
      db.insert(reviewItems).values({ topicId: 'cs.ds.array', round: 1, content: {} }),
    ).rejects.toThrow()
  })

  it('1~4 회차는 전부 만들 수 있다', async () => {
    for (const round of [1, 2, 3, 4]) {
      await expect(
        db.insert(reviewItems).values({ topicId: 'cs.ds.array', round, content: {} }),
      ).resolves.toBeDefined()
    }
  })
})

describe('topic_progress', () => {
  it('정의되지 않은 status 를 넣을 수 없다', async () => {
    await expect(
      db.insert(topicProgress).values({ topicId: 'x.y.z', status: '잘함' }),
    ).rejects.toThrow()
  })

  it('정의된 status 다섯은 전부 허용된다', async () => {
    const all = ['not_started', 'learning', 'weak', 'reviewing', 'mastered']
    for (const [i, status] of all.entries()) {
      await expect(
        db.insert(topicProgress).values({ topicId: `x.y.${i}`, status }),
      ).resolves.toBeDefined()
    }
  })

  it('★ 점수가 0~100 을 벗어날 수 없다', async () => {
    await expect(
      db.insert(topicProgress).values({ topicId: 'x.y.a', masteryScore: 101 }),
    ).rejects.toThrow()
    await expect(
      db.insert(topicProgress).values({ topicId: 'x.y.b', masteryScore: -1 }),
    ).rejects.toThrow()
  })

  it('복습 회차가 4를 넘을 수 없다', async () => {
    await expect(
      db.insert(topicProgress).values({ topicId: 'x.y.c', reviewRound: 5 }),
    ).rejects.toThrow()
  })
})

describe('daily_plans — 하루에 계획 하나', () => {
  it('★ 같은 날짜로 계획을 두 번 만들 수 없다', async () => {
    await makePlan(1, '2026-09-01')
    await expect(makePlan(2, '2026-09-01')).rejects.toThrow()
  })

  it('★ 같은 day_number 를 두 번 쓸 수 없다', async () => {
    await makePlan(1, '2026-09-01')
    await expect(makePlan(1, '2026-09-02')).rejects.toThrow()
  })

  it('다른 날짜·번호는 만들 수 있다', async () => {
    await makePlan(1, '2026-09-01')
    await expect(makePlan(2, '2026-09-02')).resolves.toBeDefined()
  })

  it('정의되지 않은 status 를 넣을 수 없다', async () => {
    await expect(
      db.insert(dailyPlans).values({
        dayNumber: 9, studyDate: '2026-09-09',
        estimatedCalls: 1, estimatedMinutes: 10, status: '대충',
      }),
    ).rejects.toThrow()
  })
})

describe('plan_items — ③겹 채점 상한', () => {
  it('★ 채점 3회차를 넣을 수 없다', async () => {
    const planId = await makePlan()
    await expect(
      db.insert(planItems).values({
        planId, topicId: 'cs.ds.array', kind: 'new', minutes: 20, priority: 100, attemptNo: 3,
      }),
    ).rejects.toThrow()
  })

  it('아직 채점 전이면 attempt_no 가 없어도 된다', async () => {
    const planId = await makePlan()
    await expect(
      db.insert(planItems).values({
        planId, topicId: 'cs.ds.array', kind: 'new', minutes: 20, priority: 100,
      }),
    ).resolves.toBeDefined()
  })

  it('★ 같은 계획에 같은 Topic 을 두 번 넣을 수 없다', async () => {
    const planId = await makePlan()
    const item = { planId, topicId: 'cs.ds.array', kind: 'new', minutes: 20, priority: 100 }
    await db.insert(planItems).values(item)
    await expect(db.insert(planItems).values(item)).rejects.toThrow()
  })

  it('정의되지 않은 kind 를 넣을 수 없다', async () => {
    const planId = await makePlan()
    await expect(
      db.insert(planItems).values({
        planId, topicId: 'cs.ds.array', kind: '보충학습', minutes: 20, priority: 100,
      }),
    ).rejects.toThrow()
  })

  it('kind 셋은 전부 허용된다', async () => {
    const planId = await makePlan()
    for (const kind of ['new', 'review', 'remediation']) {
      await expect(
        db.insert(planItems).values({
          planId, topicId: `cs.ds.${kind}`, kind, minutes: 20, priority: 100,
        }),
      ).resolves.toBeDefined()
    }
  })

  it('계획이 지워지면 항목도 함께 지워진다', async () => {
    const planId = await makePlan()
    await db.insert(planItems).values({
      planId, topicId: 'cs.ds.array', kind: 'new', minutes: 20, priority: 100,
    })
    await db.delete(dailyPlans)
    expect(await db.select().from(planItems)).toHaveLength(0)
  })
})

describe('users — 설정의 범위', () => {
  it('목표 기간이 터무니없으면 거부한다', async () => {
    await expect(db.insert(users).values({ targetDayCount: 3 })).rejects.toThrow()
    await expect(db.insert(users).values({ targetDayCount: 9999 })).rejects.toThrow()
  })

  it('하루 학습 시간이 터무니없으면 거부한다', async () => {
    await expect(db.insert(users).values({ dailyStudyMinutes: 1 })).rejects.toThrow()
    await expect(db.insert(users).values({ dailyStudyMinutes: 1000 })).rejects.toThrow()
  })

  it('기본값으로 만들 수 있다 — 90일 · 하루 60분', async () => {
    const [row] = await db.insert(users).values({}).returning()
    expect(row.targetDayCount).toBe(90)
    expect(row.dailyStudyMinutes).toBe(60)
  })
})
