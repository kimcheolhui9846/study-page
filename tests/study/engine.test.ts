import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { chatPayload, feedbackPayload, material, SECRETS, startPayload } from '../helpers/study'
import {
  aiRequests, dailyPlans, planItems, studyMaterials, studyMessages, studyProblems,
  studySessions, studySubmissions, topicContents,
} from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import { ScriptedLlmClient } from '../../lib/llm/fake'
import { LlmTransportError } from '../../lib/llm/client'
import type { LlmRequest } from '../../lib/llm/types'
import { CHAT_MODEL, WORK_MODEL } from '../../lib/llm/pricing'
import { dailyCallCap } from '../../lib/budget/caps'
import {
  requestMore, revealHint, revealSolutionFor, sendMessage, startSession, submitAnswer,
} from '../../lib/study/engine'
import { loadSessionView } from '../../lib/study/store'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-11-16T03:00:00Z')

beforeEach(async () => { ({ db, close } = await createTestDb()); vi.stubEnv('APP_ENV', 'local') })
afterEach(async () => { await close(); vi.unstubAllEnvs() })

/** 스키마 이름으로 응답을 고르는 가짜. 테스트마다 덮어쓴다 */
function llmWith(over: Partial<Record<string, (req: LlmRequest) => unknown>> = {}) {
  const table: Record<string, (req: LlmRequest) => unknown> = {
    study_start: () => startPayload('BFS 입문', 3),
    study_chat: () => chatPayload(),
    study_material: () => material('추가 자료', 2, 99),
    study_feedback: () => feedbackPayload(),
    ...over,
  }
  return new ScriptedLlmClient((req) => table[req.schemaName](req))
}

const deps = (llm: ScriptedLlmClient) => ({ db, clock, llm })

async function started(llm = llmWith(), mode: 'math' | 'coding' = 'coding') {
  const r = await startSession(deps(llm), { mode, request: '요청', requestId: randomUUID() })
  if (!r.ok) throw new Error(r.code)
  return r.value.sessionId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테이블 아무거나 세는 테스트 도우미
async function count(table: any) {
  return (await db.select().from(table)).length
}

describe('시작', () => {
  it('★ 커리큘럼에 없는 주제로 바로 시작한다 — Topic·계획을 만들지 않는다', async () => {
    const llm = llmWith()
    const r = await startSession(deps(llm), { mode: 'math', request: '갈루아 이론 입문', requestId: randomUUID() })
    expect(r.ok).toBe(true)
    expect(llm.requests[0].model).toBe(WORK_MODEL)
    expect(await count(studySessions)).toBe(1)
    expect(await count(studyMaterials)).toBe(1)
    expect(await count(studyProblems)).toBe(3)
    expect(await count(dailyPlans)).toBe(0)
    expect(await count(planItems)).toBe(0)
    expect(await count(topicContents)).toBe(0)
  })

  it('요청이 모호하면 확인 질문만 하고 자료를 만들지 않는다', async () => {
    const llm = llmWith({
      study_start: () => ({ outcome: 'clarify', clarify_question: '어느 범위를 원하나?', material: { ...material('수학', 0), blocks: [] } }),
    })
    const s = await started(llm, 'math')
    const view = (await loadSessionView(db, s))!
    expect(view.materials).toHaveLength(0)
    expect(view.messages.at(-1)?.bodyMd).toContain('어느 범위')
  })

  it('★ 같은 요청 ID 가 동시에 두 번 와도 호출 1회, 세션 1개', async () => {
    const llm = llmWith()
    const id = randomUUID()
    const [a, b] = await Promise.all([
      startSession(deps(llm), { mode: 'cs', request: 'x', requestId: id }),
      startSession(deps(llm), { mode: 'cs', request: 'x', requestId: id }),
    ])
    expect(llm.calls).toBe(1)
    expect(await count(studySessions)).toBe(1)
    expect([a.ok ? 'ok' : a.code, b.ok ? 'ok' : b.code]).toContain('IN_PROGRESS')
  })

  it('끝난 요청을 다시 보내면 저장된 결과를 돌려준다 — 호출 없음', async () => {
    const llm = llmWith()
    const id = randomUUID()
    const a = await startSession(deps(llm), { mode: 'cs', request: 'x', requestId: id })
    const b = await startSession(deps(llm), { mode: 'cs', request: 'x', requestId: id })
    expect(llm.calls).toBe(1)
    expect(b).toEqual({ ok: true, value: (a as { value: unknown }).value, replayed: true })
  })

  it('실패하면 세션을 남기지 않는다', async () => {
    const llm = llmWith({ study_start: () => new LlmTransportError() })
    const r = await startSession(deps(llm), { mode: 'cs', request: 'x', requestId: randomUUID() })
    expect(r).toMatchObject({ ok: false, code: 'GENERATION_FAILED' })
    expect(await count(studySessions)).toBe(0)
  })
})

describe('대화', () => {
  it('질문에는 luna 1회로 답하고 자료를 다시 만들지 않는다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const r = await sendMessage(deps(llm), { sessionId: s, text: '큐는 왜 쓰나?', requestId: randomUUID() })
    expect(r.ok).toBe(true)
    expect(llm.calls).toBe(2)
    expect(llm.requests[1].model).toBe(CHAT_MODEL)
    expect(await count(studyMaterials)).toBe(1)
  })

  it('★ 「2번 문제」는 그 문제를 문맥에 넣고 비밀은 넣지 않는다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    await sendMessage(deps(llm), { sessionId: s, text: '2번 문제 설명해 줘', requestId: randomUUID() })
    const user = llm.requests[1].user
    expect(user).toMatch(/학습자가 가리킨 문제\n### 2번 문제\nPROMPT-2/)
    expect(user).not.toMatch(SECRETS)
  })

  it('★ 자료 요청 의도면 terra 로 새 버전을 쌓고 옛 버전·제출은 그대로다', async () => {
    const llm = llmWith({
      study_chat: () => chatPayload({ intent: 'more_material', material_instruction: '더 쉬운 문제 2개' }),
    })
    const s = await started(llm)
    const view0 = (await loadSessionView(db, s))!
    const p1 = view0.materials[0].problems[0].id
    await submitAnswer(deps(llm), { sessionId: s, problemId: p1, answer: 'a', language: null, feedbackMode: 'full', requestId: randomUUID() })

    const r = await sendMessage(deps(llm), { sessionId: s, text: '더 쉽게 해 줘', requestId: randomUUID() })
    expect(r.ok && r.value.materialId).toBeTruthy()
    expect(llm.requests.map((q) => q.model)).toEqual([WORK_MODEL, WORK_MODEL, CHAT_MODEL, WORK_MODEL])
    expect(llm.requests[3].user).toContain('더 쉬운 문제 2개')

    const view = (await loadSessionView(db, s))!
    expect(view.materials.map((m) => m.version)).toEqual([1, 2])
    expect(view.materials[1].problems.map((p) => p.number)).toEqual([4, 5])
    expect(view.submissions[p1]).toHaveLength(1)
    expect(view.materials[0].problems[0].id).toBe(p1)
  })

  it('★ 해설 요청 의도면 그 문제만 연다 — 호출은 luna 1회', async () => {
    const llm = llmWith({ study_chat: () => chatPayload({ intent: 'reveal_solution', problem_number: 2 }) })
    const s = await started(llm)
    await sendMessage(deps(llm), { sessionId: s, text: '2번 정답 알려줘', requestId: randomUUID() })
    expect(llm.calls).toBe(2)
    const view = (await loadSessionView(db, s))!
    expect(view.materials[0].problems.map((p) => p.solution !== null)).toEqual([false, true, false])
  })

  it('★ 없는 번호의 해설 요청은 아무것도 열지 않는다', async () => {
    const llm = llmWith({ study_chat: () => chatPayload({ intent: 'reveal_solution', problem_number: 9 }) })
    const s = await started(llm)
    await sendMessage(deps(llm), { sessionId: s, text: '9번 정답', requestId: randomUUID() })
    expect(JSON.stringify(await loadSessionView(db, s))).not.toMatch(SECRETS)
  })

  it('★ 예산이 없으면 부르지 않지만 학습자 메시지는 남는다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const used = llm.calls
    for (let i = used; i < dailyCallCap(); i++) {
      await sendMessage(deps(llm), { sessionId: s, text: `q${i}`, requestId: randomUUID() })
    }
    const before = llm.calls
    const r = await sendMessage(deps(llm), { sessionId: s, text: '마지막 질문', requestId: randomUUID() })
    expect(r).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' })
    expect(llm.calls).toBe(before)
    const view = (await loadSessionView(db, s))!
    expect(view.messages.some((m) => m.bodyMd === '마지막 질문')).toBe(true)
  })

  it('없는 세션', async () => {
    const r = await sendMessage(deps(llmWith()), { sessionId: 42, text: 'x', requestId: randomUUID() })
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('추가 자료', () => {
  it('★ 같은 지시라도 새 요청 ID 면 별개 자료다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    await requestMore(deps(llm), { sessionId: s, instruction: '다른 문제', requestId: randomUUID() })
    await requestMore(deps(llm), { sessionId: s, instruction: '다른 문제', requestId: randomUUID() })
    expect(await count(studyMaterials)).toBe(3)
  })

  it('★ 실패해도 기존 자료는 그대로이고 요청은 failed 로 남는다', async () => {
    const llm = llmWith({ study_material: () => new LlmTransportError() })
    const s = await started(llm)
    const id = randomUUID()
    const r = await requestMore(deps(llm), { sessionId: s, instruction: 'x', requestId: id })
    expect(r).toMatchObject({ ok: false, code: 'GENERATION_FAILED' })
    expect(await count(studyMaterials)).toBe(1)
    const [req] = (await db.select().from(aiRequests)).filter((x) => x.requestId === id)
    expect(req.status).toBe('failed')
  })
})

describe('제출', () => {
  it('★ 코테 「오류만」은 고친 코드를 지우고 해설을 열지 않는다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const view0 = (await loadSessionView(db, s))!
    const p = view0.materials[0].problems[0].id
    const r = await submitAnswer(deps(llm), {
      sessionId: s, problemId: p, answer: 'print(1)', language: 'python', feedbackMode: 'errors-only', requestId: randomUUID(),
    })
    expect(r.ok).toBe(true)
    expect(llm.requests[1].system).toMatch(/정답 코드.*쓰지 않는다/)
    const view = (await loadSessionView(db, s))!
    const sub = view.submissions[p][0]
    expect(sub.feedback.improved_md).toBe('')
    expect(view.materials[0].problems[0].solution).toBeNull()
    expect(JSON.stringify(view)).not.toContain('IMPROVED-CODE')
  })

  it('「전체」는 고친 답을 남긴다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const p = (await loadSessionView(db, s))!.materials[0].problems[0].id
    await submitAnswer(deps(llm), { sessionId: s, problemId: p, answer: 'x', language: null, feedbackMode: 'full', requestId: randomUUID() })
    expect((await loadSessionView(db, s))!.submissions[p][0].feedback.improved_md).toBe('IMPROVED-CODE')
  })

  it('★ 판정은 서버가 루브릭으로 다시 센다', async () => {
    const llm = llmWith({
      study_feedback: () => feedbackPayload({
        verdict: 'correct',
        correct_points: ['SECRET-RUBRIC-1a', '지어낸 기준'],
        missed_points: ['SECRET-RUBRIC-1b'],
      }),
    })
    const s = await started(llm)
    const p = (await loadSessionView(db, s))!.materials[0].problems[0].id
    await submitAnswer(deps(llm), { sessionId: s, problemId: p, answer: 'x', language: null, feedbackMode: 'full', requestId: randomUUID() })
    const sub = (await loadSessionView(db, s))!.submissions[p][0]
    expect(sub.verdict).toBe('partial')
    expect(sub.feedback.correctCount).toBe(1)   // 지어낸 기준은 버린다
    expect(sub.feedback.totalCount).toBe(2)
    const [stored] = await db.select().from(studySubmissions)
    expect((stored.feedback as { correct_points: string[] }).correct_points).toEqual(['SECRET-RUBRIC-1a'])
  })

  it('★ 화면 데이터의 피드백에 루브릭 문장이 나가지 않는다 — 맞은 개수만', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const p = (await loadSessionView(db, s))!.materials[0].problems[0].id
    await submitAnswer(deps(llm), { sessionId: s, problemId: p, answer: 'x', language: null, feedbackMode: 'full', requestId: randomUUID() })
    expect(JSON.stringify(await loadSessionView(db, s))).not.toMatch(SECRETS)
  })

  it('★ 다른 세션의 문제로 제출하면 NOT_FOUND — 호출 없음', async () => {
    const llm = llmWith()
    const a = await started(llm)
    const b = await started(llm)
    const pa = (await loadSessionView(db, a))!.materials[0].problems[0].id
    const before = llm.calls
    const r = await submitAnswer(deps(llm), { sessionId: b, problemId: pa, answer: 'x', language: null, feedbackMode: 'full', requestId: randomUUID() })
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(llm.calls).toBe(before)
  })
})

describe('힌트·해설 (0원)', () => {
  it('힌트는 셋까지 열리고 넷째는 NO_MORE_HINTS', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const p = (await loadSessionView(db, s))!.materials[0].problems[0].id
    const before = llm.calls
    expect(await revealHint(deps(llm), { problemId: p })).toMatchObject({ ok: true, value: { hint: 'HINT-1-1', hintsRevealed: 1 } })
    await revealHint(deps(llm), { problemId: p })
    await revealHint(deps(llm), { problemId: p })
    expect(await revealHint(deps(llm), { problemId: p })).toMatchObject({ ok: false, code: 'NO_MORE_HINTS' })
    expect(llm.calls).toBe(before)
  })

  it('해설 보기는 저장된 해설을 열고 화면 데이터에 반영된다', async () => {
    const llm = llmWith()
    const s = await started(llm)
    const p = (await loadSessionView(db, s))!.materials[0].problems[0].id
    const r = await revealSolutionFor(deps(llm), { problemId: p })
    expect(r).toMatchObject({ ok: true, value: { answer_md: 'SECRET-ANSWER-1' } })
    const msgs = await db.select().from(studyMessages)
    expect(msgs.at(-1)?.kind).toBe('notice')
  })

  it('없는 문제', async () => {
    expect(await revealHint(deps(llmWith()), { problemId: 404 })).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })
})
