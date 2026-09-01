import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { dailyPlans, planItems, topicContents, topicProgress } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadTopicDetail } from '../../lib/progress/topic'
import { MAX_ATTEMPTS, PARK_DAYS } from '../../lib/mastery/recovery'

const ARRAY = 'cs.ds.array'
const PREREQ = 'cs.prog.variables-types'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-09-02T10:00:00+09:00')

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function setProgress(topicId: string, over: Record<string, unknown> = {}) {
  await db.insert(topicProgress).values({
    topicId,
    status: 'weak',
    masteryScore: 30,
    attemptCount: 1,
    wrongCount: 1,
    weakConcepts: [],
    lastStudiedAt: new Date('2026-09-01T10:00:00+09:00'),
    ...over,
  })
}

const detail = (topicId = ARRAY) => loadTopicDetail(db, clock, topicId)

describe('Topic 상세', () => {
  it('커리큘럼에 없으면 null 이다', async () => {
    expect(await detail('cs.없음.없음')).toBeNull()
  })

  it('학습한 적이 없으면 진도가 null 이다', async () => {
    const d = (await detail())!
    expect(d.progress).toBeNull()
    expect(d.history).toEqual([])
  })

  it('선수와 후속을 양쪽 다 담는다', async () => {
    const d = (await detail(PREREQ))!
    expect(d.prerequisites).toEqual([])
    expect(d.unlocks.length).toBeGreaterThan(0)
    expect(d.unlocks.map((u) => u.id)).toContain(ARRAY)
  })

  it('★ 선수를 못 넘겼으면 안 열렸다고 말한다', async () => {
    expect((await detail())!.unlocked).toBe(false)

    await setProgress(PREREQ, { status: 'mastered', masteryScore: 90 })
    expect((await detail())!.unlocked).toBe(true)
  })

  it('선수의 점수와 기준을 같이 준다 — 얼마나 모자란지 보여야 한다', async () => {
    await setProgress(PREREQ, { status: 'weak', masteryScore: 40 })
    const p = (await detail())!.prerequisites.find((x) => x.id === PREREQ)!

    expect(p.score).toBe(40)
    expect(p.passThreshold).toBeGreaterThan(40)
    expect(p.passed).toBe(false)
  })

  it('★ 과목을 넘는 선수를 표시한다 — 진도가 막힌 이유가 대개 여기다', async () => {
    const d = (await detail('cs.dl.backpropagation'))!
    const crossing = d.prerequisites.filter((p) => p.crossing)
    expect(crossing.length).toBeGreaterThan(0)
    expect(crossing.every((c) => c.subject !== 'cs')).toBe(true)
  })

  it('과목 간 연결을 담는다', async () => {
    const d = (await detail('cs.dl.backpropagation'))!
    expect(d.connections.map((c) => c.note).join(' ')).toContain('연쇄법칙')
    expect(d.connections[0]!.otherTitle.length).toBeGreaterThan(0)
  })
})

describe('회복 단계', () => {
  it('숙달한 Topic 에는 회복 단계가 없다', async () => {
    await setProgress(ARRAY, { status: 'mastered', masteryScore: 90 })
    expect((await detail())!.recovery).toBeNull()
  })

  it('★ 첫 실패 뒤에는 스스로 한 번 더', async () => {
    await setProgress(PREREQ, { status: 'mastered', masteryScore: 90 })
    await setProgress(ARRAY, { attemptCount: 1 })
    expect((await detail())!.recovery?.phase).toBe('retry')
  })

  it('★ 복습에서도 틀렸고 선수가 흔들리면 하위로 내려간다', async () => {
    await setProgress(PREREQ, { status: 'weak', masteryScore: 30 })
    await setProgress(ARRAY, { attemptCount: 2 })

    const r = (await detail())!.recovery!
    expect(r.phase).toBe('remediation')
    expect(r.blocking.map((b) => b.id)).toContain(PREREQ)
  })

  it('★ 세 번 하고 못 넘기면 접어둔 상태로 보인다', async () => {
    await setProgress(PREREQ, { status: 'mastered', masteryScore: 90 })
    await setProgress(ARRAY, { attemptCount: MAX_ATTEMPTS })
    expect((await detail())!.recovery?.phase).toBe('parked')
  })

  it(`접어둔 지 ${PARK_DAYS}일이 지나면 다시 온다`, async () => {
    await setProgress(PREREQ, { status: 'mastered', masteryScore: 90 })
    await setProgress(ARRAY, {
      attemptCount: MAX_ATTEMPTS,
      lastStudiedAt: new Date('2026-08-01T10:00:00+09:00'),
    })
    expect((await detail())!.recovery?.phase).toBe('retry')
  })
})

describe('기록', () => {
  async function seedHistory() {
    const [plan] = await db.insert(dailyPlans).values({
      dayNumber: 1, studyDate: '2026-09-01', estimatedCalls: 2, estimatedMinutes: 40,
    }).returning({ id: dailyPlans.id })
    const [plan2] = await db.insert(dailyPlans).values({
      dayNumber: 2, studyDate: '2026-09-02', estimatedCalls: 2, estimatedMinutes: 40,
    }).returning({ id: dailyPlans.id })

    await db.insert(planItems).values([
      {
        planId: plan!.id, topicId: ARRAY, kind: 'new', round: null,
        minutes: 20, priority: 10, status: 'done', score: 55,
      },
      {
        planId: plan2!.id, topicId: ARRAY, kind: 'review', round: null,
        minutes: 20, priority: 10, status: 'done', score: 82,
      },
    ])
    return plan2!.id
  }

  it('새 것부터 준다', async () => {
    await seedHistory()
    const h = (await detail())!.history
    expect(h.map((x) => x.studyDate)).toEqual(['2026-09-02', '2026-09-01'])
    expect(h[0]!.score).toBe(82)
  })

  it('★ 채점 안 된 항목은 기록이 아니다', async () => {
    const [plan] = await db.insert(dailyPlans).values({
      dayNumber: 1, studyDate: '2026-09-02', estimatedCalls: 1, estimatedMinutes: 20,
    }).returning({ id: dailyPlans.id })
    await db.insert(planItems).values({
      planId: plan!.id, topicId: ARRAY, kind: 'new', round: null,
      minutes: 20, priority: 10, status: 'studying', score: null,
    })

    expect((await detail())!.history).toEqual([])
  })

  it('오늘 계획에 있으면 학습 화면으로 갈 수 있다', async () => {
    await seedHistory()
    expect((await detail())!.inTodaysPlan).toBe(true)
  })

  it('오늘 계획에 없으면 못 간다 — 학습은 계획에 담긴 것만', async () => {
    const [plan] = await db.insert(dailyPlans).values({
      dayNumber: 1, studyDate: '2026-08-20', estimatedCalls: 1, estimatedMinutes: 20,
    }).returning({ id: dailyPlans.id })
    await db.insert(planItems).values({
      planId: plan!.id, topicId: ARRAY, kind: 'new', round: null,
      minutes: 20, priority: 10, status: 'done', score: 90,
    })

    expect((await detail())!.inTodaysPlan).toBe(false)
  })
})

describe('자료 유무', () => {
  it('없으면 false 다', async () => {
    expect((await detail())!.hasMaterial).toBe(false)
  })

  it('★ 있으면 true — 다시 열어도 호출이 0회라는 뜻이다', async () => {
    await db.insert(topicContents).values({
      topicId: ARRAY,
      content: {
        passage: { title: '배열', body_md: '본문', key_terms: [] },
        questions: [1, 2, 3].map((i) => ({
          id: `q${i}`, type: 'concept', prompt: `문제 ${i}`,
          expected_points: ['포인트'], hint: '',
        })),
      },
      model: 'gpt-4o-mini',
    })
    expect((await detail())!.hasMaterial).toBe(true)
  })
})
