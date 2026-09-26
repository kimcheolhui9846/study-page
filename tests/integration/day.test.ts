import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { budgetCounters, topicProgress, users } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadGraph } from '../../lib/curriculum/load'
import {
  ensureTodayPlan, loadProgressMap, markStudying, readPlan, saveAnswers,
  type StoredPlan,
} from '../../lib/plan/store'
import { ensureMaterial, type EnsureDeps } from '../../lib/llm/ensure'
import { gradePlan } from '../../lib/llm/grade'
import { loadUsage } from '../../lib/budget/usage'
import type { LlmClient, LlmRequest, LlmResult } from '../../lib/llm/types'

/**
 * 하루를 통째로 돌린다.
 *
 * ★ 이 파일이 지키는 것 하나: **계획이 예고한 호출 수와 실제 호출 수가 같다.**
 * `daily_plans.estimated_calls` 는 LLM 을 한 번도 부르기 전에 정해지고,
 * 화면이 그 숫자를 사용자에게 보여준다. 실제가 그보다 많으면 계획이
 * 예산을 거짓말한 것이다.
 */

const graph = loadGraph()

/** route 별로 다른 응답을 준다. 실제 라우팅을 흉내내되 네트워크는 없다. */
class RoutingFake implements LlmClient {
  calls = 0
  byRoute: Record<string, number> = {}
  private lastGradeTargets: string[] = []

  constructor(private readonly db: Db) {}

  async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
    this.calls += 1
    this.byRoute[req.route] = (this.byRoute[req.route] ?? 0) + 1

    let data: unknown
    if (req.route === 'content') {
      data = {
        passage: { title: '지문', body_md: '본문', key_terms: [] },
        questions: [1, 2, 3].map((i) => ({
          id: `q${i}`, type: 'concept', prompt: `문제 ${i}`,
          expected_points: ['포인트 A', '포인트 B'], hint: '힌트',
          solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
        })),
      }
    } else if (req.route === 'review') {
      data = {
        recap_md: '되짚기',
        questions: [1, 2].map((i) => ({
          id: `q${i}`, type: 'recall', prompt: `복습 ${i}`,
          expected_points: ['포인트 A'], hint: '',
          solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
        })),
      }
    } else {
      // 채점 — 프롬프트에 실린 topic_id 를 그대로 되돌려준다
      const ids = [...req.user.matchAll(/topic_id: (\S+)/g)].map((m) => m[1]!)
      this.lastGradeTargets = ids
      // 전부 맞은 것으로 채점한다 — 그래야 Topic 이 숙달되고 이튿날
      // 진짜 "복습 회차"가 잡힌다. 못 넘긴 Topic 은 무료 재학습이 되므로
      // 복습 경로를 시험하지 못한다.
      data = {
        topics: ids.map((id) => ({
          topic_id: id,
          questions: [1, 2, 3].map((n) => ({
            id: `q${n}`,
            correct_points: ['포인트 A', '포인트 B'],
            missed_points: [],
            misconceptions: [],
            feedback_ko: '무엇이 빠졌는지 적었다. 왜 필요한지도 적었다.',
          })),
          summary_seed: ['항목 1', '항목 2', '항목 3'],
          missing_prerequisites: [],
          weak_concepts: [],
        })),
      }
    }

    return { data: data as T, promptTokens: 800, completionTokens: 1200, costMicros: 840 }
  }

  gradeTargets(): string[] { return this.lastGradeTargets }
}

let db: Db
let close: () => Promise<void>

beforeEach(async () => {
  // ★ 실제 배포와 같은 캡으로 돈다. 로컬 기본값 3은 개발 중 폭주를 막는
  // 장치이지 제품의 하루가 아니다 — 그 값으로 재면 계획이 늘 잘린 채라
  // "하루를 완주한다"를 확인할 수 없다.
  vi.stubEnv('APP_ENV', 'production')
  ;({ db, close } = await createTestDb())
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await close()
})

/**
 * 하루를 산다: 자료 만들고 → 답 쓰고 → 한 번에 채점받는다.
 *
 * ★ 남은 호출 수를 화면과 같은 곳(loadUsage)에서 가져온다. 계획이 보는
 * 예산과 reserve() 가 강제하는 캡이 어긋나면, 계획은 세워지는데 호출이
 * 막히는 날이 생긴다. 여기서 같은 출처를 쓰는 것이 그 확인이다.
 */
async function liveADay(
  clock: ReturnType<typeof fixedClock>, llm: RoutingFake,
): Promise<{ plan: StoredPlan; callsBefore: number }> {
  const deps: EnsureDeps = { db, clock, llm, graph }
  const usage = await loadUsage(db, clock)
  const plan = await ensureTodayPlan(db, clock, Math.max(0, usage.dailyCap - usage.dailyCalls))
  const callsBefore = llm.calls

  for (const item of plan.items) {
    const res = await ensureMaterial(deps, {
      topicId: item.topicId,
      kind: item.kind as 'new' | 'review' | 'remediation',
      round: item.round,
      minutes: item.minutes,
    }, await loadProgressMap(db))
    expect(res.ok, `${item.topicId} 자료 생성`).toBe(true)
    if (!res.ok) continue

    // 라우트가 하는 일을 그대로 한다: 자료가 생기면 studying, 그 뒤 답 저장
    await markStudying(db, plan.id, item.topicId)
    await saveAnswers(db, plan.id, item.topicId, { q1: '내 답', q2: '내 답', q3: '내 답' })
  }

  const fresh = (await readPlan(db, plan.studyDate))!
  const graded = await gradePlan(deps, fresh)
  expect(graded.ok ? 'ok' : `${graded.code}: ${graded.message}`).toBe('ok')

  return { plan: (await readPlan(db, plan.studyDate))!, callsBefore }
}

describe('하루 완주', () => {
  it('★ 계획이 예고한 호출 수와 실제 호출 수가 같다', async () => {
    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)

    const { plan } = await liveADay(clock, llm)

    expect(plan.items.length).toBeGreaterThan(0)
    expect(llm.calls).toBe(plan.estimatedCalls)
  })

  it('★ 채점은 항목 수와 무관하게 1회다', async () => {
    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)
    await liveADay(clock, llm)

    expect(llm.byRoute.grade).toBe(1)
  })

  it('예산 카운터가 실제 호출 수와 맞는다', async () => {
    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)
    await liveADay(clock, llm)

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day!.calls).toBe(llm.calls)
  })

  it('하루가 끝나면 계획이 완료된다', async () => {
    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const { plan } = await liveADay(clock, new RoutingFake(db))

    expect(plan.status).toBe('completed')
    expect(plan.items.every((i) => i.status === 'done')).toBe(true)
  })

  it('진도가 남는다', async () => {
    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const { plan } = await liveADay(clock, new RoutingFake(db))

    const rows = await db.select().from(topicProgress)
    expect(rows).toHaveLength(plan.items.length)
    for (const r of rows) {
      expect(r.masteryScore).toBeGreaterThan(0)
      expect(r.nextReviewAt).not.toBeNull()
    }
  })
})

describe('이튿날', () => {
  it('★ 어제의 결과가 오늘의 계획을 바꾼다', async () => {
    const day1 = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)
    const { plan: first } = await liveADay(day1, llm)

    // 다음 날. 어제 배운 것의 복습이 예약되어 있다.
    const day2 = fixedClock('2026-09-02T10:00:00+09:00')
    const u2 = await loadUsage(db, day2)
    const second = await ensureTodayPlan(db, day2, u2.dailyCap - u2.dailyCalls)

    expect(second.dayNumber).toBe(2)
    expect(second.items.some((i) => i.kind === 'review')).toBe(true)

    const yesterday = new Set(first.items.map((i) => i.topicId))
    const reviews = second.items.filter((i) => i.kind === 'review')
    for (const r of reviews) expect(yesterday.has(r.topicId)).toBe(true)
  })

  it('★ 복습은 회차 콘텐츠를 새로 만든다 — 어제 지문을 다시 주지 않는다', async () => {
    const day1 = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)
    await liveADay(day1, llm)

    const day2 = fixedClock('2026-09-02T10:00:00+09:00')
    const u2 = await loadUsage(db, day2)
    const plan2 = await ensureTodayPlan(db, day2, u2.dailyCap - u2.dailyCalls)
    const review = plan2.items.find((i) => i.kind === 'review')!

    const before = llm.calls
    const res = await ensureMaterial({ db, clock: day2, llm, graph }, {
      topicId: review.topicId, kind: 'review', round: review.round, minutes: review.minutes,
    }, await loadProgressMap(db))

    expect(res.ok && res.generated).toBe(true)
    expect(llm.calls).toBe(before + 1)
    expect(llm.byRoute.review).toBe(1)
    // 복습은 문제 2개다
    expect(res.ok && res.material.questions).toHaveLength(2)
  })

  it('이튿날의 예고 호출 수도 실제와 맞는다', async () => {
    const day1 = fixedClock('2026-09-01T10:00:00+09:00')
    const llm = new RoutingFake(db)
    await liveADay(day1, llm)

    const day2 = fixedClock('2026-09-02T10:00:00+09:00')
    const before = llm.calls
    const { plan } = await liveADay(day2, llm)

    expect(llm.calls - before).toBe(plan.estimatedCalls)
  })
})

describe('예산이 모자란 날', () => {
  it('★ 계획이 캡을 넘지 않는다 — 캡을 올리는 게 아니라 계획을 줄인다', async () => {
    await db.insert(users).values({ targetDayCount: 90, dailyStudyMinutes: 300 })

    const clock = fixedClock('2026-09-01T10:00:00+09:00')
    const plan = await ensureTodayPlan(db, clock, 3)

    expect(plan.estimatedCalls).toBeLessThanOrEqual(3)
  })
})
