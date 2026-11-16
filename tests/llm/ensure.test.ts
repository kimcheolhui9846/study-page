import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { dailyCallCap } from '../../lib/budget/caps'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { budgetCounters, reviewItems, topicContents, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { loadGraph } from '../../lib/curriculum/load'
import {
  ensureMaterial, loadMaterialKeys, materialKey,
  type EnsureDeps, type MaterialRequest,
} from '../../lib/llm/ensure'
import { FailingLlmClient, FakeLlmClient } from '../../lib/llm/fake'
import type { ProgressState } from '../../lib/plan/types'

const graph = loadGraph()
const TOPIC = 'cs.prog.variables-types'

const CONTENT_PAYLOAD = {
  passage: {
    title: '변수와 자료형',
    body_md: '본문이다.',
    key_terms: [{ term: '변수', definition: '값에 붙인 이름' }],
  },
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    type: 'concept',
    prompt: `문제 ${i}`,
    expected_points: ['포인트 A', '포인트 B'],
    hint: '',
    solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
  })),
}

const REVIEW_PAYLOAD = {
  recap_md: '되짚기다.',
  questions: [1, 2].map((i) => ({
    id: `q${i}`,
    type: 'recall',
    prompt: `복습 문제 ${i}`,
    expected_points: ['포인트 A'],
    hint: '',
    solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
  })),
}

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-09-01T10:00:00+09:00')

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

function deps(llm: EnsureDeps['llm']): EnsureDeps {
  return { db, clock, llm, graph }
}

const NEW: MaterialRequest = { topicId: TOPIC, kind: 'new', round: null, minutes: 25 }
const REVIEW_1: MaterialRequest = { topicId: TOPIC, kind: 'review', round: 1, minutes: 10 }
const noProgress = new Map<string, ProgressState>()

/** 예약된 호출 수. 예산 방어선이 실제로 움직였는지 본다. */
async function callsUsed(): Promise<number> {
  const [row] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
  return row?.calls ?? 0
}

describe('신규 콘텐츠', () => {
  it('없으면 만들고 저장한다', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    const res = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.generated).toBe(true)
    expect(res.material.title).toBe('변수와 자료형')
    expect(res.material.questions).toHaveLength(3)

    const rows = await db.select().from(topicContents)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.topicId).toBe(TOPIC)
  })

  it('★ 두 번 불러도 호출은 1회다 — 멱등성 ②겹', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)

    const first = await ensureMaterial(deps(llm), NEW, noProgress)
    const second = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(llm.calls).toBe(1)
    expect(first.ok && first.generated).toBe(true)
    expect(second.ok && second.generated).toBe(false)
    expect(await callsUsed()).toBe(1)
  })

  it('★ 캐시 히트는 예산을 쓰지 않는다', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    await ensureMaterial(deps(llm), NEW, noProgress)

    const before = await callsUsed()
    await ensureMaterial(deps(llm), NEW, noProgress)
    expect(await callsUsed()).toBe(before)
  })

  it('원장에 성공이 남는다', async () => {
    await ensureMaterial(deps(new FakeLlmClient(CONTENT_PAYLOAD)), NEW, noProgress)

    const [row] = await db.select().from(usageLedger)
    expect(row!.route).toBe('content')
    expect(row!.subject).toBe('cs')
    expect(row!.ok).toBe(true)
    expect(row!.costMicros).toBe(840)
  })
})

describe('복습 콘텐츠', () => {
  it('회차별로 따로 만든다', async () => {
    const llm = new FakeLlmClient(REVIEW_PAYLOAD)
    await ensureMaterial(deps(llm), REVIEW_1, noProgress)
    await ensureMaterial(deps(llm), { ...REVIEW_1, round: 2 }, noProgress)

    expect(llm.calls).toBe(2)
    const rows = await db.select().from(reviewItems)
    expect(rows.map((r) => r.round).sort()).toEqual([1, 2])
  })

  it('같은 회차를 두 번 부르면 호출은 1회다', async () => {
    const llm = new FakeLlmClient(REVIEW_PAYLOAD)
    await ensureMaterial(deps(llm), REVIEW_1, noProgress)
    await ensureMaterial(deps(llm), REVIEW_1, noProgress)
    expect(llm.calls).toBe(1)
  })

  it('★ 복습은 topic_contents 를 건드리지 않는다 — 원래 지문이 남아야 한다', async () => {
    await ensureMaterial(deps(new FakeLlmClient(REVIEW_PAYLOAD)), REVIEW_1, noProgress)
    expect(await db.select().from(topicContents)).toHaveLength(0)
  })

  it('제목은 Topic 에서 온다 — 복습 응답에는 제목이 없다', async () => {
    const res = await ensureMaterial(deps(new FakeLlmClient(REVIEW_PAYLOAD)), REVIEW_1, noProgress)
    expect(res.ok && res.material.title).toBe(graph.topics.get(TOPIC)!.title)
  })

  it('원장의 route 가 review 다 — 무엇에 돈이 나갔는지 구분된다', async () => {
    await ensureMaterial(deps(new FakeLlmClient(REVIEW_PAYLOAD)), REVIEW_1, noProgress)
    const [row] = await db.select().from(usageLedger)
    expect(row!.route).toBe('review')
  })
})

describe('취약 재학습 (round === null)', () => {
  it('★ 원래 콘텐츠를 그대로 쓴다 — 호출 0회', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    await ensureMaterial(deps(llm), NEW, noProgress)
    const callsAfterFirst = llm.calls

    const res = await ensureMaterial(
      deps(llm), { topicId: TOPIC, kind: 'review', round: null, minutes: 15 }, noProgress,
    )

    expect(llm.calls).toBe(callsAfterFirst)
    expect(res.ok && res.generated).toBe(false)
    expect(res.ok && res.material.questions).toHaveLength(3)
  })

  it('다시 배울 원래 자료가 없으면 만들지 않고 알린다', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    const res = await ensureMaterial(
      deps(llm), { topicId: TOPIC, kind: 'review', round: null, minutes: 15 }, noProgress,
    )

    expect(res.ok).toBe(false)
    expect(!res.ok && res.code).toBe('STORED_INVALID')
    expect(llm.calls).toBe(0)
  })
})

describe('예산 (③겹)', () => {
  it('★ 예산이 없으면 LLM 을 부르지 않는다', async () => {
    // 일일 캡을 다 써버린 상태를 만든다
    await db.insert(budgetCounters).values({
      periodKey: 'day:2026-09-01', calls: dailyCallCap(), capCalls: dailyCallCap(), capMicros: 3_000_000,
    })

    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    const res = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(res.ok).toBe(false)
    expect(!res.ok && res.code).toBe('BUDGET_EXCEEDED')
    expect(llm.calls).toBe(0)
    expect(await db.select().from(topicContents)).toHaveLength(0)
  })
})

describe('실패 경로', () => {
  it('★ 호출이 던지면 예약을 되돌린다 — 캡을 헛되이 쓰지 않는다', async () => {
    const llm = new FailingLlmClient()
    const res = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(!res.ok && res.code).toBe('GENERATION_FAILED')
    expect(llm.calls).toBe(1)
    expect(await callsUsed()).toBe(0)

    const [row] = await db.select().from(usageLedger)
    expect(row!.ok).toBe(false)
  })

  it('★ 응답이 스키마에 안 맞으면 예약을 되돌리지 않는다 — 돈은 이미 나갔다', async () => {
    const llm = new FakeLlmClient({ passage: { title: '반쪽' } })
    const res = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(!res.ok && res.code).toBe('GENERATION_FAILED')
    expect(await callsUsed()).toBe(1)

    const [row] = await db.select().from(usageLedger)
    expect(row!.ok).toBe(false)
    expect(row!.costMicros).toBe(840)
  })

  it('깨진 응답은 저장하지 않는다', async () => {
    await ensureMaterial(deps(new FakeLlmClient({ nonsense: true })), NEW, noProgress)
    expect(await db.select().from(topicContents)).toHaveLength(0)
  })

  it('커리큘럼에 없는 Topic 은 부르기 전에 막는다', async () => {
    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    const res = await ensureMaterial(deps(llm), { ...NEW, topicId: 'cs.없음.없음' }, noProgress)

    expect(!res.ok && res.code).toBe('UNKNOWN_TOPIC')
    expect(llm.calls).toBe(0)
    expect(await callsUsed()).toBe(0)
  })

  it('★ 저장된 자료가 지금 형식으로 안 읽히면 다시 만들지 않는다', async () => {
    await db.insert(topicContents).values({
      topicId: TOPIC, content: { passage: { title: '옛 형식' } }, model: 'gpt-4o-mini',
    })

    const llm = new FakeLlmClient(CONTENT_PAYLOAD)
    const res = await ensureMaterial(deps(llm), NEW, noProgress)

    expect(!res.ok && res.code).toBe('STORED_INVALID')
    expect(llm.calls).toBe(0)
  })
})

describe('프롬프트로 흘러드는 것', () => {
  it('★ 금지어가 실제로 프롬프트에 실린다', async () => {
    let sent = ''
    const llm = {
      calls: 0,
      async generate<T>(req: { user: string }) {
        sent = req.user
        return { data: CONTENT_PAYLOAD as T, promptTokens: 1, completionTokens: 1, costMicros: 1 }
      },
    }

    await ensureMaterial(deps(llm as never), NEW, noProgress)
    expect(sent).toContain('아직 배우지 않은 것 (쓰지 마라)')
  })

  it('★ 계획이 정한 분량이 실린다 — Topic 의 기본값이 아니라', async () => {
    let sent = ''
    const llm = {
      async generate<T>(req: { user: string }) {
        sent = req.user
        return { data: CONTENT_PAYLOAD as T, promptTokens: 1, completionTokens: 1, costMicros: 1 }
      },
    }

    await ensureMaterial(deps(llm as never), { ...NEW, minutes: 45 }, noProgress)
    expect(sent).toContain('45분')
  })

  it('복습은 복습 시스템 프롬프트를 쓴다', async () => {
    let system = ''
    const llm = {
      async generate<T>(req: { system: string }) {
        system = req.system
        return { data: REVIEW_PAYLOAD as T, promptTokens: 1, completionTokens: 1, costMicros: 1 }
      },
    }

    await ensureMaterial(deps(llm as never), REVIEW_1, noProgress)
    expect(system).toContain('처음부터 다시 가르치지 마라')
  })
})

describe('자료 유무 조회 (화면이 정직하게 말하기 위한 것)', () => {
  it('신규 자료의 키는 topicId 다', () => {
    expect(materialKey(TOPIC, 'new', null)).toBe(TOPIC)
    expect(materialKey(TOPIC, 'remediation', null)).toBe(TOPIC)
  })

  it('복습 자료의 키에는 회차가 붙는다', () => {
    expect(materialKey(TOPIC, 'review', 2)).toBe(`${TOPIC}#2`)
  })

  it('★ 취약 재학습(round null)은 원래 자료를 쓰므로 키가 topicId 다', () => {
    expect(materialKey(TOPIC, 'review', null)).toBe(TOPIC)
  })

  it('저장된 것만 담는다', async () => {
    expect(await loadMaterialKeys(db)).toEqual(new Set())

    await ensureMaterial(deps(new FakeLlmClient(CONTENT_PAYLOAD)), NEW, noProgress)
    await ensureMaterial(deps(new FakeLlmClient(REVIEW_PAYLOAD)), REVIEW_1, noProgress)

    expect(await loadMaterialKeys(db)).toEqual(new Set([TOPIC, `${TOPIC}#1`]))
  })
})
