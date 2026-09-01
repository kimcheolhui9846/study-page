import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { FakeLlmClient } from '../../lib/llm/fake'
import { getOrCreateContent } from '../../lib/study/content'
import { budgetCounters, studyDays, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')
  vi.stubEnv('APP_ENV', 'local')
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const dayCounter = async () => (await db.select().from(budgetCounters)
  .where(eq(budgetCounters.periodKey, 'day:2026-09-01')))[0]

/**
 * Structured Outputs 가 형식을 보장하지만 우리 쪽에서도 본다.
 *
 * ★ 여기서 막지 못하면 그 Day 는 평생 망가진다. study_days 의 UNIQUE 제약
 * 때문에 같은 과목·Day 를 다시 만들 수 없기 때문이다. 저장 전에 거른다.
 */
describe('응답 검증', () => {
  it('★ 문제가 3개가 아니면 저장하지 않는다', async () => {
    const broken = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [
        { id: 'q1', type: 'recall', prompt: '문제', expected_points: ['포인트'], hint: '' },
        { id: 'q2', type: 'concept', prompt: '문제', expected_points: ['포인트'], hint: '' },
      ],
    })

    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('★ 루브릭이 빈 응답도 막는다 — 채점할 근거가 없다', async () => {
    const noRubric = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [1, 2, 3].map((i) => ({
        id: `q${i}`, type: 'concept', prompt: '문제', expected_points: [], hint: '',
      })),
    })

    await expect(getOrCreateContent({ db, clock, llm: noRubric }, 'cs', 1)).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('지문 본문이 비어도 막는다', async () => {
    const empty = new FakeLlmClient({
      passage: { title: '제목', body_md: '', key_terms: [] },
      questions: [1, 2, 3].map((i) => ({
        id: `q${i}`, type: 'concept', prompt: '문제', expected_points: ['포인트'], hint: '',
      })),
    })

    await expect(getOrCreateContent({ db, clock, llm: empty }, 'cs', 1)).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('검증 실패도 예산을 되돌린다', async () => {
    const broken = new FakeLlmClient({ passage: {}, questions: [] })
    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()
    expect((await dayCounter()).calls).toBe(0)
  })

  it('검증 실패를 원장에 남긴다 — 무슨 일이 있었는지 알아야 한다', async () => {
    const broken = new FakeLlmClient({ passage: {}, questions: [] })
    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()

    const [row] = await db.select().from(usageLedger)
    expect(row.route).toBe('content')
    expect(row.ok).toBe(false)
  })

  it('★ 원장의 model 이 gpt-4o-mini 다 — 더 이상 fake 가 아니다', async () => {
    await getOrCreateContent({ db, clock, llm: new FakeLlmClient() }, 'cs', 1)
    const [row] = await db.select().from(usageLedger)
    expect(row.model).toBe('gpt-4o-mini')
  })

  it('검증에 실패해도 다음 시도가 막히지 않는다 — Day 가 살아 있다', async () => {
    const broken = new FakeLlmClient({ passage: {}, questions: [] })
    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()

    // 두 번째 시도는 정상 응답. Day 가 비어 있으므로 다시 만들 수 있어야 한다.
    const out = await getOrCreateContent({ db, clock, llm: new FakeLlmClient() }, 'cs', 1)
    expect(out.status).toBe('ok')
    expect(await db.select().from(studyDays)).toHaveLength(1)
  })
})
