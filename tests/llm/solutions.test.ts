import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dailyCallCap } from '../../lib/budget/caps'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { budgetCounters, topicContents, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadGraph } from '../../lib/curriculum/load'
import { FailingLlmClient, FakeLlmClient } from '../../lib/llm/fake'
import {
  backfillSolutions, topicsMissingSolutions, type BackfillDeps,
} from '../../lib/llm/solutions'
import { StoredContentSchema } from '../../lib/llm/schemas'

const graph = loadGraph()
const TOPIC = 'cs.prog.variables-types'
const OTHER = 'english.grammar.sentence-structure'

/** 해설이 없던 시절에 저장된 모양. */
function oldContent() {
  return {
    passage: {
      title: '변수와 자료형',
      body_md: '변수는 값에 붙인 이름이다.',
      key_terms: [{ term: '변수', definition: '값에 붙인 이름' }],
    },
    questions: [1, 2, 3].map((i) => ({
      id: `q${i}`,
      type: 'concept',
      prompt: `문제 ${i}`,
      expected_points: ['포인트 A', '포인트 B'],
      hint: '',
    })),
  }
}

function solutionsPayload(ids = ['q1', 'q2', 'q3']) {
  return {
    solutions: ids.map((id) => ({
      id,
      answer_md: `${id} 모범답안`,
      steps: ['먼저 이것', '다음에 저것'],
      evidence: '변수는 값에 붙인 이름이다.',
    })),
  }
}

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-09-27T10:00:00+09:00')

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  vi.stubEnv('APP_ENV', 'production') // 운영 캡 (lib/budget/caps.ts)
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

function deps(llm: BackfillDeps['llm']): BackfillDeps {
  return { db, clock, llm, graph }
}

async function seed(topicId: string, content: unknown) {
  await db.insert(topicContents).values({
    topicId, content: content as object, model: 'gpt-4o-mini',
  })
}

async function stored(topicId: string) {
  const [row] = await db.select().from(topicContents)
    .where(eq(topicContents.topicId, topicId))
  return StoredContentSchema.parse(row!.content)
}

describe('해설이 빠진 자료 찾기', () => {
  it('해설이 없는 것만 준다', async () => {
    await seed(TOPIC, oldContent())
    await seed(OTHER, {
      ...oldContent(),
      questions: oldContent().questions.map((q) => ({
        ...q, solution: { answer_md: '있다', steps: ['하나'], evidence: '' },
      })),
    })

    expect(await topicsMissingSolutions(db)).toEqual([TOPIC])
  })

  it('★ 하나라도 빠지면 대상이다 — 절반만 채워진 자료가 있을 수 있다', async () => {
    const half = oldContent()
    half.questions[0] = {
      ...half.questions[0]!,
      solution: { answer_md: '있다', steps: ['하나'], evidence: '' },
    } as never
    await seed(TOPIC, half)

    expect(await topicsMissingSolutions(db)).toEqual([TOPIC])
  })

  it('빈 DB 는 빈 배열이다', async () => {
    expect(await topicsMissingSolutions(db)).toEqual([])
  })
})

describe('해설 채우기', () => {
  it('★ 해설을 채우고 지문과 문제는 그대로 둔다', async () => {
    await seed(TOPIC, oldContent())
    const before = await stored(TOPIC)

    const out = await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)
    expect(out).toMatchObject({ status: 'filled', questions: 3 })

    const after = await stored(TOPIC)
    // 학습자가 이미 읽고 답한 것이다. 바뀌면 복구가 아니라 덮어쓰기다.
    expect(after.passage).toEqual(before.passage)
    expect(after.questions.map((q) => q.prompt)).toEqual(before.questions.map((q) => q.prompt))
    expect(after.questions.map((q) => q.expected_points))
      .toEqual(before.questions.map((q) => q.expected_points))

    expect(after.questions.map((q) => q.solution?.answer_md))
      .toEqual(['q1 모범답안', 'q2 모범답안', 'q3 모범답안'])
  })

  it('이미 해설이 있으면 부르지 않는다', async () => {
    await seed(TOPIC, {
      ...oldContent(),
      questions: oldContent().questions.map((q) => ({
        ...q, solution: { answer_md: '있다', steps: ['하나'], evidence: '' },
      })),
    })

    const llm = new FakeLlmClient(solutionsPayload())
    const out = await backfillSolutions(deps(llm), TOPIC)

    expect(out).toMatchObject({ status: 'skipped' })
    expect(await db.select().from(usageLedger)).toHaveLength(0)
  })

  it('저장된 자료가 없으면 만들지 않는다 — 이건 채우기지 생성이 아니다', async () => {
    const out = await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)
    expect(out).toMatchObject({ status: 'skipped' })
    expect(await db.select().from(topicContents)).toHaveLength(0)
  })

  it('★ 예산 게이트를 지난다 — 스크립트가 캡 밖으로 새지 않는다', async () => {
    await seed(TOPIC, oldContent())
    await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-27'))
    expect(day!.calls).toBe(1)
  })

  it('★ 캡을 다 썼으면 호출하지 않는다', async () => {
    await seed(TOPIC, oldContent())
    await db.insert(budgetCounters).values({
      periodKey: 'day:2026-09-27',
      calls: dailyCallCap(), capCalls: dailyCallCap(), costMicros: 0, capMicros: 3_000_000,
    })

    const out = await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)
    expect(out).toMatchObject({ status: 'failed' })
    expect((await stored(TOPIC)).questions[0]!.solution).toBeUndefined()
  })

  it('★ 호출이 실패하면 예약을 되돌린다 — 돈이 안 나갔다', async () => {
    await seed(TOPIC, oldContent())
    const out = await backfillSolutions(deps(new FailingLlmClient()), TOPIC)

    expect(out).toMatchObject({ status: 'failed' })
    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-27'))
    expect(day!.calls).toBe(0)
  })

  it('★ 모델이 문제를 빠뜨리면 아무것도 쓰지 않는다', async () => {
    // 절반만 채워두면 다음에 무엇이 남았는지 알기 어렵고 화면이 들쭉날쭉해진다.
    await seed(TOPIC, oldContent())
    const out = await backfillSolutions(deps(new FakeLlmClient(solutionsPayload(['q1']))), TOPIC)

    expect(out).toMatchObject({ status: 'failed' })
    for (const q of (await stored(TOPIC)).questions) {
      expect(q.solution).toBeUndefined()
    }
  })

  it('형식이 깨진 응답은 거르고 예약은 되돌리지 않는다 — 돈은 이미 나갔다', async () => {
    await seed(TOPIC, oldContent())
    const out = await backfillSolutions(deps(new FakeLlmClient({ solutions: 'nope' })), TOPIC)

    expect(out).toMatchObject({ status: 'failed' })
    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-27'))
    expect(day!.calls).toBe(1)
  })

  it('원장에 solution 경로로 남는다', async () => {
    await seed(TOPIC, oldContent())
    await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)

    const [entry] = await db.select().from(usageLedger)
    expect(entry).toMatchObject({ route: 'solution', subject: 'cs', ok: true })
  })

  it('채운 뒤에는 대상에서 빠진다', async () => {
    await seed(TOPIC, oldContent())
    await backfillSolutions(deps(new FakeLlmClient(solutionsPayload())), TOPIC)
    expect(await topicsMissingSolutions(db)).toEqual([])
  })
})
