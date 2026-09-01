import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { FakeLlmClient, FailingLlmClient } from '../../lib/llm/fake'
import { gradeAnswers } from '../../lib/study/grade'
import { reserve } from '../../lib/budget/reserve'
import { dailyCallCap } from '../../lib/budget/caps'
import { attempts, budgetCounters, studyDays, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import type { LlmClient, LlmRequest, LlmResult } from '../../lib/llm/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let llm: FakeLlmClient

const GRADE_PAYLOAD = {
  per_question: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    score: 67,
    correct_points: ['맞은 것'],
    missed_points: ['놓친 것'],
    misconceptions: [],
    feedback_ko: '왕복 횟수를 짚지 않았다. 그게 있어야 근거가 선다.',
  })),
  overall: { score: 67, goal_reached: false, verdict: 'revise' },
  summary_seed: ['항목 1', '항목 2', '항목 3'],
}

const CONTENT = {
  passage: { title: '제목', body_md: '본문', key_terms: [] },
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`, type: 'concept', prompt: `문제 ${i}`,
    expected_points: [`포인트 ${i}`], hint: `힌트 ${i}`,
  })),
}

const ANSWERS = { q1: '답 하나', q2: '답 둘', q3: '답 셋' }

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z') // KST 2026-09-01
  llm = new FakeLlmClient(GRADE_PAYLOAD)
  vi.stubEnv('APP_ENV', 'local') // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const deps = () => ({ db, clock, llm })

async function seedDay() {
  const [row] = await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01', content: CONTENT,
  }).returning()
  return row
}

const dayCounter = async () => (await db.select().from(budgetCounters)
  .where(eq(budgetCounters.periodKey, 'day:2026-09-01')))[0]

describe('채점', () => {
  it('첫 채점은 attempt_no 1 이다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    expect(out.status).toBe('ok')
    if (out.status !== 'ok') throw new Error('ok 여야 한다')
    expect(out.attemptNo).toBe(1)
    expect(out.feedback.overall.score).toBe(67)
    expect(llm.calls).toBe(1)
  })

  it('답안과 피드백을 attempts 에 남긴다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    const [row] = await db.select().from(attempts)
    expect(row.answers).toEqual(ANSWERS)
    expect(row.feedback).not.toBeNull()
  })

  it('두 번째 채점은 attempt_no 2 다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status === 'ok' && out.attemptNo).toBe(2)
  })

  it('★ 세 번째는 attempt_cap 이고 LLM 을 부르지 않는다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    const before = llm.calls
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    expect(out.status).toBe('attempt_cap')
    expect(llm.calls).toBe(before) // 늘지 않았다
    expect(await db.select().from(attempts)).toHaveLength(2)
  })

  it('Day 가 없으면 no_such_day 이고 LLM 을 부르지 않는다', async () => {
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status).toBe('no_such_day')
    expect(llm.calls).toBe(0)
  })

  it('★ 전부 빈 답안은 LLM 을 부르지 않는다 — 순수한 낭비다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, { q1: '  ', q2: '', q3: '\n' })

    expect(out.status).toBe('empty_answers')
    expect(llm.calls).toBe(0)
    expect(await db.select().from(attempts)).toHaveLength(0) // 슬롯도 안 쓴다
  })

  it('하나라도 답이 있으면 채점한다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, { q1: '답', q2: '', q3: '' })
    expect(out.status).toBe('ok')
  })

  it('★ 예산 캡에 걸리면 채점 슬롯을 되돌린다', async () => {
    await seedDay()
    for (let i = 0; i < dailyCallCap(); i++) await reserve(db, clock)

    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    expect(out.status).toBe('cap_exceeded')
    expect(llm.calls).toBe(0)
    // 호출도 못 했는데 재시도 기회를 잃으면 안 된다
    expect(await db.select().from(attempts)).toHaveLength(0)
  })

  it('★ LLM 이 실패하면 슬롯과 예산을 모두 되돌린다', async () => {
    await seedDay()
    await expect(
      gradeAnswers({ db, clock, llm: new FailingLlmClient() }, 'cs', 1, ANSWERS),
    ).rejects.toThrow()

    expect(await db.select().from(attempts)).toHaveLength(0)
    expect((await dayCounter()).calls).toBe(0)
  })

  it('LLM 이 실패하면 원장에 실패로 남긴다', async () => {
    await seedDay()
    await expect(
      gradeAnswers({ db, clock, llm: new FailingLlmClient() }, 'cs', 1, ANSWERS),
    ).rejects.toThrow()

    const [row] = await db.select().from(usageLedger)
    expect(row.route).toBe('grade')
    expect(row.ok).toBe(false)
  })

  it('★ 스키마에 안 맞는 채점 결과는 저장하지 않는다', async () => {
    await seedDay()
    const bad = new FakeLlmClient({ ...GRADE_PAYLOAD, summary_seed: [] })

    await expect(gradeAnswers({ db, clock, llm: bad }, 'cs', 1, ANSWERS)).rejects.toThrow()
    expect(await db.select().from(attempts)).toHaveLength(0)
  })

  it('성공하면 예산을 1 소모하고 원장에 남긴다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    expect((await dayCounter()).calls).toBe(1)
    const [row] = await db.select().from(usageLedger)
    expect(row.route).toBe('grade')
    expect(row.model).toBe('gpt-4o-mini')
    expect(row.ok).toBe(true)
  })

  it('★ 채점 호출의 temperature 는 0 이다 — 같은 답에 같은 점수', async () => {
    await seedDay()
    let seen: LlmRequest | null = null
    const spy: LlmClient = {
      async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
        seen = req
        return { data: GRADE_PAYLOAD as T, promptTokens: 10, completionTokens: 10, costMicros: 1 }
      },
    }

    await gradeAnswers({ db, clock, llm: spy }, 'cs', 1, ANSWERS)
    expect(seen!.temperature).toBe(0)
    expect(seen!.route).toBe('grade')
  })

  it('★ 채점 메시지에 루브릭이 들어간다 — 재현 가능한 채점의 근거다', async () => {
    await seedDay()
    let seen: LlmRequest | null = null
    const spy: LlmClient = {
      async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
        seen = req
        return { data: GRADE_PAYLOAD as T, promptTokens: 10, completionTokens: 10, costMicros: 1 }
      },
    }

    await gradeAnswers({ db, clock, llm: spy }, 'cs', 1, ANSWERS)
    expect(seen!.user).toContain('포인트 1')
    expect(seen!.user).toContain('답 하나')
    expect(seen!.user).not.toContain('힌트 1') // 채점과 무관한 토큰
  })

  it('다른 과목의 채점 슬롯과 섞이지 않는다', async () => {
    await seedDay()
    await db.insert(studyDays).values({
      subject: 'math', dayNo: 1, studyDate: '2026-09-01', content: CONTENT,
    })

    await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    const out = await gradeAnswers(deps(), 'math', 1, ANSWERS)

    expect(out.status === 'ok' && out.attemptNo).toBe(1) // math 는 1회차다
  })
})
