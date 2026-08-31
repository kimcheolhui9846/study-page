import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { FakeLlmClient, FailingLlmClient } from '../../lib/llm/fake'
import { getOrCreateContent } from '../../lib/study/content'
import { reserve } from '../../lib/budget/reserve'
import { dailyCallCap } from '../../lib/budget/caps'
import { studyDays, budgetCounters, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let llm: FakeLlmClient

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z') // KST 2026-09-01
  llm = new FakeLlmClient()
  vi.stubEnv('APP_ENV', 'local')             // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const deps = () => ({ db, clock, llm })

/** 예산을 캡까지 미리 소진시킨다 */
async function exhaustBudget() {
  for (let i = 0; i < dailyCallCap(); i++) {
    expect(await reserve(db, clock)).not.toBeNull()
  }
}

describe('② 멱등성', () => {
  it('첫 요청에 LLM 을 1회 호출한다', async () => {
    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(out.status).toBe('ok')
    expect(llm.calls).toBe(1)
  })

  it('★ 같은 Day 를 10번 요청해도 LLM 호출은 1회다 — 새로고침 폭탄 방어', async () => {
    for (let i = 0; i < 10; i++) await getOrCreateContent(deps(), 'cs', 1)
    expect(llm.calls).toBe(1)
    expect(await db.select().from(studyDays)).toHaveLength(1)
  })

  it('캐시 히트는 예산을 소모하지 않는다', async () => {
    await getOrCreateContent(deps(), 'cs', 1) // 예산 1 소모

    for (let i = 0; i < 20; i++) {
      const out = await getOrCreateContent(deps(), 'cs', 1)
      expect(out.status).toBe('ok') // 캡 3을 훨씬 넘겼는데도 통과해야 한다
    }
    expect(llm.calls).toBe(1)
  })

  it('캐시 히트도 루브릭을 벗겨서 준다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(JSON.stringify(out)).not.toContain('expected_points')
  })
})

describe('② 당일 추가 생성 없음', () => {
  it('같은 과목의 다른 Day 를 같은 날 시작할 수 없다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const out = await getOrCreateContent(deps(), 'cs', 2)
    expect(out.status).toBe('already_studied_today')
    expect(llm.calls).toBe(1)
  })

  it('다른 과목은 같은 날 시작할 수 있다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const out = await getOrCreateContent(deps(), 'math', 1)
    expect(out.status).toBe('ok')
    expect(llm.calls).toBe(2)
  })

  it('다음 날에는 다음 Day 를 시작할 수 있다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    clock.advance(24 * 60 * 60 * 1000)
    const out = await getOrCreateContent(deps(), 'cs', 2)
    expect(out.status).toBe('ok')
    expect(llm.calls).toBe(2)
  })
})

describe('③ 예산 캡', () => {
  it('★ 캡을 넘으면 LLM 을 호출하지 않고 cap_exceeded 를 준다', async () => {
    await exhaustBudget()

    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(out.status).toBe('cap_exceeded')
    expect(llm.calls).toBe(0)                      // 호출 자체가 없었다
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('생성 성공 시 예산을 1 소모한다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(1)
  })

  it('LLM 이 실패하면 예산을 되돌린다 — 캡을 헛되이 소모하지 않는다', async () => {
    const failing = new FailingLlmClient()
    await expect(
      getOrCreateContent({ db, clock, llm: failing }, 'cs', 1),
    ).rejects.toThrow()

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(0)
  })

  it('LLM 이 실패하면 원장에 실패로 남긴다', async () => {
    const failing = new FailingLlmClient()
    await expect(
      getOrCreateContent({ db, clock, llm: failing }, 'cs', 1),
    ).rejects.toThrow()

    const ledger = await db.select().from(usageLedger)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].ok).toBe(false)
  })

  it('LLM 이 실패하면 study_days 에 아무것도 남기지 않는다', async () => {
    const failing = new FailingLlmClient()
    await expect(
      getOrCreateContent({ db, clock, llm: failing }, 'cs', 1),
    ).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })
})

describe('루브릭 유출 방지', () => {
  const withSecrets = {
    passage: { title: '제목', body_md: '본문', key_terms: [] },
    questions: [{
      id: 'q1', type: 'concept', prompt: '설명하라',
      expected_points: ['비밀 루브릭'], hint: '비밀 힌트',
    }],
  }

  it('★ expected_points 와 hint 가 응답에 섞여 나가지 않는다', async () => {
    llm = new FakeLlmClient(withSecrets)
    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(out.status).toBe('ok')

    const json = JSON.stringify(out)
    expect(json).not.toContain('expected_points')
    expect(json).not.toContain('비밀 루브릭')
    expect(json).not.toContain('hint')
    expect(json).not.toContain('비밀 힌트')
  })

  it('루브릭은 DB 에는 남아 있다 — 2주차 채점이 이걸 쓴다', async () => {
    llm = new FakeLlmClient(withSecrets)
    await getOrCreateContent(deps(), 'cs', 1)

    const [row] = await db.select().from(studyDays)
    const stored = JSON.stringify(row.content)
    expect(stored).toContain('비밀 루브릭')
    expect(stored).toContain('비밀 힌트')
  })

  it('문제의 id, type, prompt 는 그대로 나간다', async () => {
    llm = new FakeLlmClient(withSecrets)
    const out = await getOrCreateContent(deps(), 'cs', 1)
    if (out.status !== 'ok') throw new Error('ok 여야 한다')

    expect(out.content.questions).toEqual([
      { id: 'q1', type: 'concept', prompt: '설명하라' },
    ])
  })
})

describe('커리큘럼에 없는 Day', () => {
  it('LLM 을 호출하지 않고 예산도 쓰지 않는다', async () => {
    const out = await getOrCreateContent(deps(), 'cs', 9999)
    expect(out.status).toBe('no_such_day')
    expect(llm.calls).toBe(0)
    expect(await db.select().from(budgetCounters)).toHaveLength(0)
  })
})
