import { describe, it, expect } from 'vitest'
import { loadGraph } from '../../lib/curriculum/load'
import { buildDailyPlan } from '../../lib/plan/build'
import { masteryScore } from '../../lib/mastery/score'
import { outcomeFor } from '../../lib/mastery/transition'
import { resetSchedule, scheduleNext } from '../../lib/mastery/schedule'
import type { ProgressState } from '../../lib/plan/types'
import type { DailyPlan } from '../../lib/plan/types'

/**
 * ★ 2단계의 핵심 테스트.
 *
 * 가상의 30일을 돌린다. 매일 계획을 세우고, 점수를 주고, 숙련도를 갱신하고,
 * 다음 날 계획이 그 결과를 반영하는지 본다. **LLM 을 한 번도 부르지 않는다.**
 *
 * 여기가 초록이면 "학습 결과에 따라 다음 학습이 달라진다"가 사실이다.
 */

const graph = loadGraph()

interface SimOptions {
  days: number
  dailyStudyMinutes?: number
  callsPerDay?: number
  /** topicId 와 회차를 받아 0~1 의 정답률을 낸다 */
  answerRate: (topicId: string, attempt: number) => number
}

interface SimResult {
  plans: DailyPlan[]
  progress: Map<string, ProgressState>
  attempts: Map<string, number>
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function simulate(opts: SimOptions): SimResult {
  const start = '2026-09-01'
  const progress = new Map<string, ProgressState>()
  const attempts = new Map<string, number>()
  const plans: DailyPlan[] = []

  for (let day = 1; day <= opts.days; day++) {
    const studyDate = addDays(start, day - 1)
    const now = new Date(`${studyDate}T01:00:00Z`) // KST 그날 아침

    const plan = buildDailyPlan(graph, {
      studyDate,
      dayNumber: day,
      dailyStudyMinutes: opts.dailyStudyMinutes ?? 60,
      targetDayCount: 90,
      progress,
      callsLeft: opts.callsPerDay ?? 20,
    }, now)
    plans.push(plan)

    // 그날의 학습 결과를 반영한다 — 실제 흐름과 같은 순서다
    for (const item of plan.items) {
      const topic = graph.topics.get(item.topicId)!
      const prev = progress.get(item.topicId)
      const attempt = (attempts.get(item.topicId) ?? 0) + 1
      attempts.set(item.topicId, attempt)

      const rate = opts.answerRate(item.topicId, attempt)
      const totalPoints = 3
      const correct = Math.round(rate * totalPoints)

      const score = masteryScore({
        correctPoints: correct,
        missedPoints: totalPoints - correct,
        difficulty: topic.difficulty,
        usedHint: false,
        repeatedMistake: (prev?.wrongCount ?? 0) > 0,
        previousScore: prev?.masteryScore,
      })

      const outcome = outcomeFor(score)
      const wrongCount = (prev?.wrongCount ?? 0) + (score < 60 ? 1 : 0)

      const sched = outcome.scheduleSpacedReview
        ? scheduleNext(
            { round: prev?.reviewRound ?? 0, nextReviewAt: null },
            topic.reviewIntervals, now,
          )
        : resetSchedule(topic.reviewIntervals, now)

      progress.set(item.topicId, {
        topicId: item.topicId,
        status: outcome.status,
        masteryScore: score,
        wrongCount,
        nextReviewAt: sched.nextReviewAt,
        reviewRound: sched.round,
        lastStudiedAt: studyDate,
      })
    }
  }

  return { plans, progress, attempts }
}

const ALWAYS_GOOD = () => 1
const ALWAYS_BAD = () => 0

describe('30일 시뮬레이션 — 잘하는 학습자', () => {
  const sim = simulate({ days: 30, answerRate: ALWAYS_GOOD })

  it('매일 계획이 나온다', () => {
    expect(sim.plans).toHaveLength(30)
    for (const p of sim.plans) {
      expect(p.items.length, `Day ${p.dayNumber} 가 비었다`).toBeGreaterThan(0)
    }
  })

  it('★ 진도가 나아간다', () => {
    const mastered = [...sim.progress.values()].filter((p) => p.status === 'mastered')
    expect(mastered.length).toBeGreaterThan(20)
  })

  it('★ 선수를 건너뛰지 않는다 — 배운 Topic 의 선수는 먼저 배웠다', () => {
    const orderStudied = new Map<string, number>()
    sim.plans.forEach((p, i) => {
      for (const item of p.items) {
        if (!orderStudied.has(item.topicId)) orderStudied.set(item.topicId, i)
      }
    })

    for (const [topicId, dayIdx] of orderStudied) {
      for (const pre of graph.topics.get(topicId)!.prerequisites) {
        const preDay = orderStudied.get(pre)
        expect(preDay, `${topicId} 를 배웠는데 선수 ${pre} 를 안 배웠다`).toBeDefined()
        expect(preDay!, `${pre} 가 ${topicId} 보다 늦다`).toBeLessThanOrEqual(dayIdx)
      }
    }
  })

  it('★ 복습이 섞인다 — 신규만 하지 않는다', () => {
    const reviews = sim.plans.flatMap((p) => p.items).filter((i) => i.kind === 'review')
    expect(reviews.length).toBeGreaterThan(10)
  })

  it('★ 세 과목이 모두 진행된다 — 한 과목만 파지 않는다', () => {
    const bySubject = new Map<string, number>()
    for (const p of sim.plans) {
      for (const i of p.items) bySubject.set(i.subject, (bySubject.get(i.subject) ?? 0) + 1)
    }
    expect(bySubject.get('english')).toBeGreaterThan(0)
    expect(bySubject.get('math')).toBeGreaterThan(0)
    expect(bySubject.get('cs')).toBeGreaterThan(0)
  })

  it('같은 Topic 을 하루에 두 번 담지 않는다', () => {
    for (const p of sim.plans) {
      const ids = p.items.map((i) => i.topicId)
      expect(new Set(ids).size, `Day ${p.dayNumber} 에 중복`).toBe(ids.length)
    }
  })

  it('★ 복습 회차가 4를 넘지 않는다 — 콘텐츠 생성 상한', () => {
    for (const p of sim.plans) {
      for (const i of p.items) {
        if (i.round !== null) expect(i.round, `${i.topicId}`).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('30일 시뮬레이션 — 계속 틀리는 학습자', () => {
  const sim = simulate({ days: 30, answerRate: ALWAYS_BAD })

  it('★ 진도가 막힌다 — 못 하는데 계속 나아가지 않는다', () => {
    const mastered = [...sim.progress.values()].filter((p) => p.status === 'mastered')
    expect(mastered).toHaveLength(0)
  })

  it('★ 같은 Topic 을 반복한다', () => {
    const repeated = [...sim.attempts.values()].filter((n) => n > 1)
    expect(repeated.length).toBeGreaterThan(0)
  })

  it('★ 계획이 비지 않는다 — 막혔다고 할 일이 없어지면 안 된다', () => {
    for (const p of sim.plans) {
      expect(p.items.length, `Day ${p.dayNumber} 가 비었다`).toBeGreaterThan(0)
    }
  })

  it('★ 선수를 못 넘겼으므로 깊은 Topic 에 도달하지 못한다', () => {
    expect(sim.progress.has('cs.dl.backpropagation')).toBe(false)
    expect(sim.progress.has('cs.ml.linear-regression')).toBe(false)
  })
})

describe('30일 시뮬레이션 — 한 과목만 못하는 학습자', () => {
  // 수학만 틀린다. 영어·CS 는 잘한다.
  const sim = simulate({
    days: 30,
    answerRate: (topicId) => (topicId.startsWith('math.') ? 0 : 1),
  })

  it('★ 수학이 막혀도 영어는 나아간다 — 과목별 진도는 독립이다', () => {
    const english = [...sim.progress.values()]
      .filter((p) => p.topicId.startsWith('english.') && p.status === 'mastered')
    expect(english.length).toBeGreaterThan(3)
  })

  it('수학은 숙달하지 못한다', () => {
    const math = [...sim.progress.values()]
      .filter((p) => p.topicId.startsWith('math.') && p.status === 'mastered')
    expect(math).toHaveLength(0)
  })

  it('★ 수학을 선수로 갖는 CS Topic 은 열리지 않는다 — 선수 관계는 독립이 아니다', () => {
    // cs.prog.numpy 의 선수에 math.la.matrix-ops 가 있다
    expect(sim.progress.has('cs.prog.numpy')).toBe(false)
    expect(sim.progress.has('cs.ml.overview')).toBe(false)
  })

  it('수학을 선수로 갖지 않는 CS Topic 은 열린다', () => {
    expect(sim.progress.has('cs.prog.variables-types')).toBe(true)
    expect(sim.progress.has('cs.ds.array')).toBe(true)
  })
})

describe('예산과 시간이 계획을 좌우한다', () => {
  it('★ 하루 호출이 3이면 30일 내내 그 안에 머문다', () => {
    const sim = simulate({ days: 30, callsPerDay: 3, answerRate: ALWAYS_GOOD })
    for (const p of sim.plans) {
      expect(p.estimatedCalls, `Day ${p.dayNumber}`).toBeLessThanOrEqual(3)
    }
  })

  it('★ 예산이 빠듯하면 진도가 느려진다 — 캡이 올라가지 않는다', () => {
    const tight = simulate({ days: 30, callsPerDay: 3, answerRate: ALWAYS_GOOD })
    const loose = simulate({ days: 30, callsPerDay: 20, answerRate: ALWAYS_GOOD })
    expect(tight.progress.size).toBeLessThan(loose.progress.size)
  })

  it('★ 하루 시간이 짧으면 진도가 느려진다', () => {
    const short = simulate({ days: 30, dailyStudyMinutes: 25, answerRate: ALWAYS_GOOD })
    const long = simulate({ days: 30, dailyStudyMinutes: 120, answerRate: ALWAYS_GOOD })
    expect(short.progress.size).toBeLessThan(long.progress.size)
  })

  it('매일 시간을 넘지 않는다', () => {
    const sim = simulate({ days: 30, dailyStudyMinutes: 45, answerRate: ALWAYS_GOOD })
    for (const p of sim.plans) {
      expect(p.estimatedMinutes, `Day ${p.dayNumber}`).toBeLessThanOrEqual(45)
    }
  })
})
