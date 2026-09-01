import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import {
  budgetCounters, dailyPlans, planItems, topicContents, topicProgress, usageLedger,
} from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadGraph } from '../../lib/curriculum/load'
import { gradePlan, reconcilePoints } from '../../lib/llm/grade'
import { readPlan, type StoredPlan } from '../../lib/plan/store'
import { FailingLlmClient, FakeLlmClient } from '../../lib/llm/fake'
import type { EnsureDeps } from '../../lib/llm/ensure'

const graph = loadGraph()
const A = 'cs.prog.variables-types'
const B = 'english.grammar.sentence-structure'

const content = (title: string) => ({
  passage: { title, body_md: '본문', key_terms: [] },
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`, type: 'concept', prompt: `문제 ${i}`,
    expected_points: ['포인트 A', '포인트 B'], hint: '',
  })),
})

const gradedTopic = (topicId: string, correct: number) => ({
  topic_id: topicId,
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    correct_points: correct > 0 ? ['포인트 A'] : [],
    missed_points: correct > 0 ? ['포인트 B'] : ['포인트 A', '포인트 B'],
    misconceptions: [],
    feedback_ko: '무엇이 빠졌는지 적었다. 왜 필요한지도 적었다.',
  })),
  summary_seed: ['항목 1', '항목 2', '항목 3'],
  missing_prerequisites: [],
  weak_concepts: ['헷갈린 것'],
})

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-09-01T10:00:00+09:00')

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

function deps(llm: unknown): EnsureDeps {
  return { db, clock, llm: llm as EnsureDeps['llm'], graph }
}

/** 답안까지 채워진 오늘 계획을 손으로 만든다. 계획 엔진은 여기 관심 없다. */
async function seedPlan(
  topicIds: string[],
  opts: { withAnswers?: boolean; withContent?: boolean } = {},
): Promise<StoredPlan> {
  const withAnswers = opts.withAnswers ?? true
  const withContent = opts.withContent ?? true

  const [plan] = await db.insert(dailyPlans).values({
    dayNumber: 1, studyDate: '2026-09-01',
    estimatedCalls: topicIds.length + 1, estimatedMinutes: 60,
  }).returning({ id: dailyPlans.id })

  for (const topicId of topicIds) {
    if (withContent) {
      await db.insert(topicContents).values({
        topicId, content: content(graph.topics.get(topicId)!.title), model: 'gpt-4o-mini',
      })
    }
    await db.insert(planItems).values({
      planId: plan!.id, topicId, kind: 'new', round: null, minutes: 20, priority: 100,
      status: 'studying',
      answers: withAnswers ? { q1: '내 답 1', q2: '내 답 2', q3: '내 답 3' } : null,
    })
  }

  return (await readPlan(db, '2026-09-01'))!
}

async function callsUsed(): Promise<number> {
  const [row] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
  return row?.calls ?? 0
}

describe('계획 단위 채점', () => {
  it('★ 항목이 3개여도 호출은 1회다 — 이 라우트의 존재 이유다', async () => {
    const plan = await seedPlan([A, B, 'cs.ds.array'])
    const llm = new FakeLlmClient({
      topics: [gradedTopic(A, 1), gradedTopic(B, 1), gradedTopic('cs.ds.array', 1)],
    })

    const res = await gradePlan(deps(llm), plan)

    expect(res.ok).toBe(true)
    expect(llm.calls).toBe(1)
    expect(await callsUsed()).toBe(1)
    expect(res.ok && res.items).toHaveLength(3)
  })

  it('★ 채점 온도는 0이다 — 같은 답에 다른 판정이 나오면 안 된다', async () => {
    const plan = await seedPlan([A])
    let temperature = -1
    await gradePlan(deps({
      async generate(req: { temperature: number }) {
        temperature = req.temperature
        return { data: { topics: [gradedTopic(A, 1)] }, promptTokens: 1, completionTokens: 1, costMicros: 1 }
      },
    }), plan)

    expect(temperature).toBe(0)
  })

  it('숙련도를 실제로 갱신한다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 1)] })), plan)

    const [row] = await db.select().from(topicProgress).where(eq(topicProgress.topicId, A))
    expect(row!.masteryScore).toBeGreaterThan(0)
    expect(row!.attemptCount).toBe(1)
    expect(row!.nextReviewAt).not.toBeNull()
  })

  it('★ 점수는 포인트 개수에서 나온다 — 모델은 점수를 대지 않는다', async () => {
    const plan = await seedPlan([A])
    // 3문제 × (맞음 1 / 놓침 1) = 3 / 6
    const res = await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 1)] })), plan)

    expect(res.ok && res.items[0]!.correctPoints).toBe(3)
    expect(res.ok && res.items[0]!.missedPoints).toBe(3)
  })

  it('전부 놓친 답은 취약으로 떨어진다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 0)] })), plan)

    const [row] = await db.select().from(topicProgress).where(eq(topicProgress.topicId, A))
    expect(row!.status).toBe('weak')
    expect(row!.wrongCount).toBe(1)
  })

  it('취약 개념을 누적한다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 0)] })), plan)

    const [row] = await db.select().from(topicProgress).where(eq(topicProgress.topicId, A))
    expect(row!.weakConcepts).toEqual(['헷갈린 것'])
  })

  it('항목에 답안·피드백·점수를 남긴다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 1)] })), plan)

    const [row] = await db.select().from(planItems).where(eq(planItems.topicId, A))
    expect(row!.status).toBe('done')
    expect(row!.attemptNo).toBe(1)
    expect(row!.score).toBeGreaterThan(0)
    expect((row!.answers as Record<string, string>).q1).toBe('내 답 1')
    expect(row!.feedback).not.toBeNull()
  })

  it('전부 채점되면 계획이 완료된다', async () => {
    const plan = await seedPlan([A, B])
    const res = await gradePlan(
      deps(new FakeLlmClient({ topics: [gradedTopic(A, 1), gradedTopic(B, 1)] })), plan,
    )

    expect(res.ok && res.planCompleted).toBe(true)
    const [row] = await db.select().from(dailyPlans)
    expect(row!.status).toBe('completed')
  })

  it('★ 모델이 한 주제를 빠뜨리면 그 항목은 채점되지 않은 채 남는다', async () => {
    const plan = await seedPlan([A, B])
    const res = await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 1)] })), plan)

    expect(res.ok && res.items).toHaveLength(1)
    const [row] = await db.select().from(planItems).where(eq(planItems.topicId, B))
    expect(row!.status).toBe('studying')
    expect(row!.score).toBeNull()
    expect(res.ok && res.planCompleted).toBe(false)
  })

  it('원장에 채점이 남는다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FakeLlmClient({ topics: [gradedTopic(A, 1)] })), plan)

    const [row] = await db.select().from(usageLedger)
    expect(row!.route).toBe('grade')
    expect(row!.ok).toBe(true)
  })
})

describe('부르지 않는 경우', () => {
  it('★ 답안이 없으면 부르지 않는다', async () => {
    const plan = await seedPlan([A], { withAnswers: false })
    const llm = new FakeLlmClient({ topics: [gradedTopic(A, 1)] })
    const res = await gradePlan(deps(llm), plan)

    expect(!res.ok && res.code).toBe('NO_ANSWERS')
    expect(llm.calls).toBe(0)
    expect(await callsUsed()).toBe(0)
  })

  it('★ 예산이 없으면 부르지 않는다', async () => {
    const plan = await seedPlan([A])
    await db.insert(budgetCounters).values({
      periodKey: 'day:2026-09-01', calls: 5, capCalls: 5, capMicros: 3_000_000,
    })

    const llm = new FakeLlmClient({ topics: [gradedTopic(A, 1)] })
    const res = await gradePlan(deps(llm), plan)

    expect(!res.ok && res.code).toBe('BUDGET_EXCEEDED')
    expect(llm.calls).toBe(0)
  })

  it('★ 자료를 읽을 수 없으면 부르지 않는다 — 루브릭 없이는 채점이 아니다', async () => {
    const plan = await seedPlan([A], { withContent: false })
    const llm = new FakeLlmClient({ topics: [gradedTopic(A, 1)] })
    const res = await gradePlan(deps(llm), plan)

    expect(!res.ok && res.code).toBe('MATERIAL_MISSING')
    expect(llm.calls).toBe(0)
  })

  it('이미 채점이 끝난 계획은 다시 부르지 않는다', async () => {
    const plan = await seedPlan([A])
    const llm = new FakeLlmClient({ topics: [gradedTopic(A, 1)] })
    await gradePlan(deps(llm), plan)

    const again = await gradePlan(deps(llm), (await readPlan(db, '2026-09-01'))!)
    expect(!again.ok && again.code).toBe('NO_ANSWERS')
    expect(llm.calls).toBe(1)
  })
})

describe('실패 경로', () => {
  it('★ 호출이 던지면 예약을 되돌린다', async () => {
    const plan = await seedPlan([A])
    const res = await gradePlan(deps(new FailingLlmClient()), plan)

    expect(!res.ok && res.code).toBe('GRADING_FAILED')
    expect(await callsUsed()).toBe(0)
  })

  it('★ 응답이 형식에 안 맞으면 예약을 되돌리지 않는다 — 돈은 이미 나갔다', async () => {
    const plan = await seedPlan([A])
    const res = await gradePlan(deps(new FakeLlmClient({ topics: [] })), plan)

    expect(!res.ok && res.code).toBe('GRADING_FAILED')
    expect(await callsUsed()).toBe(1)
  })

  it('채점에 실패해도 항목은 studying 으로 남는다 — 다시 시도할 수 있다', async () => {
    const plan = await seedPlan([A])
    await gradePlan(deps(new FailingLlmClient()), plan)

    const [row] = await db.select().from(planItems).where(eq(planItems.topicId, A))
    expect(row!.status).toBe('studying')
    expect((row!.answers as Record<string, string>).q1).toBe('내 답 1')
  })
})

describe('프롬프트로 흘러드는 것', () => {
  it('★ 루브릭이 실린다 — 이게 없으면 채점이 매번 달라진다', async () => {
    const plan = await seedPlan([A])
    let sent = ''
    await gradePlan(deps({
      async generate(req: { user: string }) {
        sent = req.user
        return { data: { topics: [gradedTopic(A, 1)] }, promptTokens: 1, completionTokens: 1, costMicros: 1 }
      },
    }), plan)

    expect(sent).toContain('포인트 A')
    expect(sent).toContain('내 답 1')
  })

  it('★ 여러 주제가 한 메시지에 실린다', async () => {
    const plan = await seedPlan([A, B])
    let sent = ''
    await gradePlan(deps({
      async generate(req: { user: string }) {
        sent = req.user
        return {
          data: { topics: [gradedTopic(A, 1), gradedTopic(B, 1)] },
          promptTokens: 1, completionTokens: 1, costMicros: 1,
        }
      },
    }), plan)

    expect(sent).toContain(`topic_id: ${A}`)
    expect(sent).toContain(`topic_id: ${B}`)
  })
})

describe('루브릭에 맞춰 다시 세기', () => {
  const RUBRIC = ['주어는 "The tall man"이다.', '동사는 "ran"이다.']

  it('★ 같은 포인트가 양쪽에 있으면 놓친 것으로 본다 — 실제로 겪은 일이다', () => {
    // 2026-09-02 실호출에서 모델이 포인트 2개짜리 문제를 3개로 만들었다.
    // 「동사는 ran이다」를 맞음과 놓침 양쪽에 넣고, 틀린 답에 부분 점수를 줬다.
    const r = reconcilePoints(RUBRIC, {
      correct_points: ['주어는 "The tall man"이다.', '동사는 "ran"이다.'],
      missed_points: ['동사는 "ran"이다.'],
    })

    expect(r.correct_points).toEqual(['주어는 "The tall man"이다.'])
    expect(r.missed_points).toEqual(['동사는 "ran"이다.'])
  })

  it('★ 맞음 + 놓침은 언제나 루브릭 개수와 같다', () => {
    const cases = [
      { correct_points: [], missed_points: [] },
      { correct_points: RUBRIC, missed_points: RUBRIC },
      { correct_points: ['지어낸 포인트'], missed_points: [] },
      { correct_points: RUBRIC, missed_points: [] },
    ]
    for (const c of cases) {
      const r = reconcilePoints(RUBRIC, c)
      expect(r.correct_points.length + r.missed_points.length).toBe(RUBRIC.length)
    }
  })

  it('루브릭에 없는 포인트는 버린다 — 모델이 지어낸 것이다', () => {
    const r = reconcilePoints(RUBRIC, {
      correct_points: ['지어낸 포인트', '주어는 "The tall man"이다.'],
      missed_points: [],
    })
    expect(r.correct_points).toEqual(['주어는 "The tall man"이다.'])
    expect(r.missed_points).toEqual(['동사는 "ran"이다.'])
  })

  it('언급되지 않은 포인트는 놓친 것이다', () => {
    const r = reconcilePoints(RUBRIC, { correct_points: [], missed_points: [] })
    expect(r.correct_points).toEqual([])
    expect(r.missed_points).toEqual(RUBRIC)
  })

  it('공백 차이는 같은 포인트로 본다', () => {
    const r = reconcilePoints(['가  나   다'], {
      correct_points: ['가 나 다'], missed_points: [],
    })
    expect(r.correct_points).toEqual(['가  나   다'])
  })

  it('돌려주는 문자열은 루브릭 원문이다 — 모델이 고쳐 쓴 문장이 아니라', () => {
    const r = reconcilePoints(RUBRIC, {
      correct_points: ['동사는  "ran"이다.'], missed_points: [],
    })
    expect(r.correct_points).toEqual(['동사는 "ran"이다.'])
  })
})

describe('부풀린 채점을 계획 전체에서 막는다', () => {
  it('★ 모델이 포인트를 부풀려도 점수의 분모가 루브릭 개수를 넘지 않는다', async () => {
    const plan = await seedPlan([A])
    // 문제마다 루브릭은 2개인데 모델이 3개로 부풀린다
    const inflated = {
      topics: [{
        ...gradedTopic(A, 1),
        questions: [1, 2, 3].map((i) => ({
          id: `q${i}`,
          correct_points: ['포인트 A', '포인트 B'],
          missed_points: ['포인트 B'],
          misconceptions: [],
          feedback_ko: '설명이다. 이유도 적었다.',
        })),
      }],
    }

    const res = await gradePlan(deps(new FakeLlmClient(inflated)), plan)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    // 3문제 × 루브릭 2개 = 6. 모델이 9개를 냈어도 6이다.
    expect(res.items[0]!.correctPoints + res.items[0]!.missedPoints).toBe(6)
    // 다투는 포인트 B 는 놓친 것으로 간다
    expect(res.items[0]!.correctPoints).toBe(3)
  })

  it('★ 저장되는 피드백도 정리된 것이다 — 화면과 점수가 어긋날 수 없다', async () => {
    const plan = await seedPlan([A])
    const inflated = {
      topics: [{
        ...gradedTopic(A, 1),
        questions: [{
          id: 'q1',
          correct_points: ['포인트 A', '포인트 B'],
          missed_points: ['포인트 B'],
          misconceptions: [],
          feedback_ko: '설명이다. 이유도 적었다.',
        }],
      }],
    }

    await gradePlan(deps(new FakeLlmClient(inflated)), plan)

    const [row] = await db.select().from(planItems).where(eq(planItems.topicId, A))
    const feedback = row!.feedback as { questions: Array<{ id: string; correct_points: string[]; missed_points: string[] }> }

    // 모델은 q1 만 채점했지만 문제는 3개다. 나머지는 전부 놓침으로 남는다.
    expect(feedback.questions).toHaveLength(3)
    const q1 = feedback.questions.find((q) => q.id === 'q1')!
    expect(q1.correct_points).toEqual(['포인트 A'])
    expect(q1.missed_points).toEqual(['포인트 B'])

    const q2 = feedback.questions.find((q) => q.id === 'q2')!
    expect(q2.correct_points).toEqual([])
    expect(q2.missed_points).toEqual(['포인트 A', '포인트 B'])
  })
})
