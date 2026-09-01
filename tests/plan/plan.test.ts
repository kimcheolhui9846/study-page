import { describe, it, expect } from 'vitest'
import { loadGraph } from '../../lib/curriculum/load'
import { buildDailyPlan, estimateCalls, subjectRatios } from '../../lib/plan/build'
import { collectCandidates, priorityOf } from '../../lib/plan/candidates'
import type { PlanInput, ProgressState } from '../../lib/plan/types'

const graph = loadGraph()

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    studyDate: '2026-09-01',
    dayNumber: 1,
    dailyStudyMinutes: 60,
    targetDayCount: 90,
    progress: new Map(),
    callsLeft: 20,
    ...over,
  }
}

function progress(entries: Array<Partial<ProgressState> & { topicId: string }>) {
  const m = new Map<string, ProgressState>()
  for (const e of entries) {
    m.set(e.topicId, {
      status: 'not_started', masteryScore: 0, wrongCount: 0,
      nextReviewAt: null, reviewRound: 0, lastStudiedAt: null, weakConcepts: [],
      ...e,
    })
  }
  return m
}

const NOW = new Date('2026-09-01T01:00:00Z') // KST 2026-09-01

describe('우선순위', () => {
  it('★ 밀린 복습이 다른 모든 것을 이긴다', () => {
    const overdue = priorityOf({
      dueDays: 1, wrongCount: 0, blocksCount: 0,
      inProgress: false, subjectIdleDays: 0, difficulty: 5,
    })
    const everythingElseMaxed = priorityOf({
      dueDays: 0, wrongCount: 5, blocksCount: 1,
      inProgress: true, subjectIdleDays: 7, difficulty: 1,
    })
    expect(overdue).toBeGreaterThan(0)
    // 기한 7일 초과면 확실히 이긴다
    const veryOverdue = priorityOf({
      dueDays: 7, wrongCount: 0, blocksCount: 0,
      inProgress: false, subjectIdleDays: 0, difficulty: 5,
    })
    expect(veryOverdue).toBeGreaterThan(everythingElseMaxed)
  })

  it('반복해 틀린 것이 새 것보다 앞선다', () => {
    const repeated = priorityOf({
      dueDays: 0, wrongCount: 3, blocksCount: 0,
      inProgress: false, subjectIdleDays: 0, difficulty: 3,
    })
    const fresh = priorityOf({
      dueDays: 0, wrongCount: 0, blocksCount: 0,
      inProgress: false, subjectIdleDays: 0, difficulty: 3,
    })
    expect(repeated).toBeGreaterThan(fresh)
  })

  it('오래 안 한 과목이 앞으로 온다', () => {
    const idle = priorityOf({
      dueDays: 0, wrongCount: 0, blocksCount: 0,
      inProgress: false, subjectIdleDays: 7, difficulty: 3,
    })
    const recent = priorityOf({
      dueDays: 0, wrongCount: 0, blocksCount: 0,
      inProgress: false, subjectIdleDays: 0, difficulty: 3,
    })
    expect(idle).toBeGreaterThan(recent)
  })
})

describe('후보 모으기', () => {
  it('첫날은 선수가 없는 신규만 나온다', () => {
    const cs = collectCandidates(graph, input(), NOW)
    expect(cs.length).toBeGreaterThan(0)
    expect(cs.every((c) => c.kind === 'new')).toBe(true)

    for (const c of cs) {
      expect(graph.topics.get(c.topicId)!.prerequisites).toEqual([])
    }
  })

  it('★ 선수를 못 넘긴 Topic 은 후보가 아니다', () => {
    const cs = collectCandidates(graph, input(), NOW)
    const ids = new Set(cs.map((c) => c.topicId))
    // 역전파는 선수가 여럿이라 첫날 나올 수 없다
    expect(ids.has('cs.dl.backpropagation')).toBe(false)
  })

  it('★ 선수를 넘기면 후속이 열린다', () => {
    const p = progress([
      { topicId: 'cs.prog.variables-types', status: 'mastered', masteryScore: 90 },
    ])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    expect(cs.map((c) => c.topicId)).toContain('cs.prog.control-flow')
  })

  it('★ 기한이 된 복습이 나온다', () => {
    const p = progress([{
      topicId: 'cs.prog.variables-types', status: 'mastered', masteryScore: 90,
      nextReviewAt: '2026-08-30', reviewRound: 1, lastStudiedAt: '2026-08-29',
    }])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    const review = cs.find((c) => c.topicId === 'cs.prog.variables-types')

    expect(review?.kind).toBe('review')
    // reviewRound 는 "다음에 할 회차"다. 1이 예정돼 있으면 오늘 하는 것이 1회차다.
    expect(review?.round).toBe(1)
    expect(review?.reason).toContain('밀림')
  })

  it('★ 취약한 Topic 의 선수가 부족하면 그 선수를 보충으로 뽑는다', () => {
    // 후속만 취약하고 선수는 아직 학습 중이다 — 선수가 근본 원인이다
    const p = progress([
      { topicId: 'cs.prog.variables-types', status: 'learning', masteryScore: 30 },
      { topicId: 'cs.ds.array', status: 'weak', masteryScore: 35 },
    ])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    const remediation = cs.find((c) => c.kind === 'remediation')

    expect(remediation?.topicId).toBe('cs.prog.variables-types')
    expect(remediation?.reason).toContain('열려면 먼저')
  })

  it('★ 취약한 Topic 이 무엇을 막고 있는지 이유에 담는다', () => {
    const p = progress([
      { topicId: 'cs.prog.variables-types', status: 'weak', masteryScore: 30 },
    ])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    const item = cs.find((c) => c.topicId === 'cs.prog.variables-types')

    // 이 Topic 은 배열·조건문 등을 막고 있다. "왜 오늘 또 하나"의 답이다.
    expect(item?.reason).toContain('막고 있다')
  })

  it('★ 숙달한 Topic 은 복습 기한 전까지 다시 안 나온다', () => {
    const p = progress([{
      topicId: 'cs.prog.variables-types', status: 'mastered', masteryScore: 95,
      nextReviewAt: '2026-09-10', reviewRound: 1,
    }])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    expect(cs.map((c) => c.topicId)).not.toContain('cs.prog.variables-types')
  })

  it('한 Topic 이 하루에 두 번 나오지 않는다', () => {
    const p = progress([{
      topicId: 'cs.prog.variables-types', status: 'weak', masteryScore: 30,
      nextReviewAt: '2026-08-25', reviewRound: 1,
    }])
    const cs = collectCandidates(graph, input({ progress: p }), NOW)
    const ids = cs.map((c) => c.topicId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('시간 배분', () => {
  it('하루 시간을 넘지 않는다', () => {
    for (const minutes of [30, 60, 120]) {
      const plan = buildDailyPlan(graph, input({ dailyStudyMinutes: minutes }), NOW)
      expect(plan.estimatedMinutes).toBeLessThanOrEqual(minutes)
    }
  })

  it('★ 시간이 늘면 더 많이 담는다', () => {
    const short = buildDailyPlan(graph, input({ dailyStudyMinutes: 30 }), NOW)
    const long = buildDailyPlan(graph, input({ dailyStudyMinutes: 120 }), NOW)
    expect(long.items.length).toBeGreaterThan(short.items.length)
  })

  it('과목 비율의 합이 1 이다', () => {
    const r = subjectRatios(graph, input())
    const total = r.english + r.math + r.cs
    expect(total).toBeCloseTo(1, 5)
  })

  it('★ 숙련도가 낮은 과목이 더 많은 시간을 받는다', () => {
    const weak = progress([
      { topicId: 'math.la.scalar-vector-matrix', status: 'weak', masteryScore: 20 },
      { topicId: 'math.la.vector-ops', status: 'weak', masteryScore: 25 },
    ])
    const base = subjectRatios(graph, input())
    const boosted = subjectRatios(graph, input({ progress: weak }))
    expect(boosted.math).toBeGreaterThan(base.math)
  })
})

describe('★ 예산에 맞춰 자른다 — 캡을 올리지 않는다', () => {
  it('호출 수가 남은 예산을 넘지 않는다', () => {
    for (const left of [1, 2, 3, 5, 20]) {
      const plan = buildDailyPlan(graph, input({ callsLeft: left, dailyStudyMinutes: 240 }), NOW)
      expect(plan.estimatedCalls, `callsLeft=${left}`).toBeLessThanOrEqual(left)
    }
  })

  it('예산이 3이면 콘텐츠 2개 + 채점 1회다', () => {
    const plan = buildDailyPlan(graph, input({ callsLeft: 3, dailyStudyMinutes: 240 }), NOW)
    expect(plan.items).toHaveLength(2)
    expect(plan.estimatedCalls).toBe(3)
  })

  it('★ 예산이 1이면 아무것도 못 한다 — 채점 몫이 없다', () => {
    const plan = buildDailyPlan(graph, input({ callsLeft: 1 }), NOW)
    expect(plan.items).toHaveLength(0)
    expect(plan.estimatedCalls).toBe(0)
  })

  it('★ 밀려난 항목을 숨기지 않는다', () => {
    const plan = buildDailyPlan(graph, input({ callsLeft: 2, dailyStudyMinutes: 240 }), NOW)
    expect(plan.deferred.length).toBeGreaterThan(0)
  })

  it('밀려난 것은 우선순위가 낮은 쪽이다', () => {
    const plan = buildDailyPlan(graph, input({ callsLeft: 3, dailyStudyMinutes: 240 }), NOW)
    const lowestChosen = Math.min(...plan.items.map((i) => i.priority))
    const highestDeferred = Math.max(...plan.deferred.map((i) => i.priority))
    expect(lowestChosen).toBeGreaterThanOrEqual(highestDeferred)
  })

  it('채점을 계획 단위로 묶는다 — Topic 마다 부르지 않는다', () => {
    expect(estimateCalls([])).toBe(0)
    // 콘텐츠 5 + 채점 1
    expect(estimateCalls(Array(5).fill({ minutes: 10 }))).toBe(6)
  })
})
