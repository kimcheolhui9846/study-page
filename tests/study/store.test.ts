import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { material, SECRETS } from '../helpers/study'
import type { Db } from '../../lib/db/types'
import { MaterialGen } from '../../lib/study/schemas'
import {
  appendMessage, createSession, findProblem, findProblemByNumber, insertMaterial,
  insertSubmission, listRecentSessions, loadSessionView, revealNextHint, revealSolution,
  problemSession,
} from '../../lib/study/store'

let db: Db
let close: () => Promise<void>
const clock = fixedClock('2026-11-16T03:00:00Z')

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

const gen = (title: string, n: number) => MaterialGen.parse(material(title, n))

async function newSession(title = '학습') {
  return createSession(db, clock, { mode: 'coding', request: '요청', title })
}

describe('자료와 문제 번호', () => {
  it('★ 자료는 버전으로 쌓이고 문제 번호는 세션 전체에서 이어진다', async () => {
    const s = await newSession()
    const v1 = await insertMaterial(db, clock, { sessionId: s, parentId: null, requestId: 'r1', gen: gen('A', 3) })
    const v2 = await insertMaterial(db, clock, { sessionId: s, parentId: v1.materialId, requestId: 'r2', gen: gen('B', 2) })

    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect((await findProblemByNumber(db, s, 4))?.materialId).toBe(v2.materialId)
    expect((await findProblemByNumber(db, s, 1))?.materialId).toBe(v1.materialId)

    const view = await loadSessionView(db, s)
    expect(view!.materials.map((m) => m.problems.map((p) => p.number)))
      .toEqual([[1, 2, 3], [4, 5]])
  })

  it('★ 다른 세션의 문제는 찾지 못한다', async () => {
    const a = await newSession('A')
    const b = await newSession('B')
    const { problemIds } = await insertMaterial(db, clock, { sessionId: a, parentId: null, requestId: 'r', gen: gen('A', 1) })

    expect(await findProblem(db, a, problemIds[0])).not.toBeNull()
    expect(await findProblem(db, b, problemIds[0])).toBeNull()
    expect(await findProblemByNumber(db, b, 1)).toBeNull()
    expect(await problemSession(db, problemIds[0])).toBe(a)
  })
})

describe('공개 상태', () => {
  it('힌트는 셋에서 멈춘다', async () => {
    const s = await newSession()
    const { problemIds: [p] } = await insertMaterial(db, clock, { sessionId: s, parentId: null, requestId: 'r', gen: gen('A', 1) })
    expect(await revealNextHint(db, p)).toBe(1)
    expect(await revealNextHint(db, p)).toBe(2)
    expect(await revealNextHint(db, p)).toBe(3)
    expect(await revealNextHint(db, p)).toBe(3)
  })

  it('★ 화면 데이터에 공개 전 비밀이 없고, 공개 후에는 그 문제 것만 있다', async () => {
    const s = await newSession()
    const { problemIds } = await insertMaterial(db, clock, { sessionId: s, parentId: null, requestId: 'r', gen: gen('A', 2) })

    expect(JSON.stringify(await loadSessionView(db, s))).not.toMatch(SECRETS)

    await revealSolution(db, problemIds[0])
    const text = JSON.stringify(await loadSessionView(db, s))
    expect(text).toContain('SECRET-SOLUTION-1')
    expect(text).not.toContain('SECRET-SOLUTION-2')
    expect(text).not.toMatch(/SECRET-RUBRIC/)
  })
})

describe('복원', () => {
  it('★ 메시지·자료·제출을 순서대로 되돌려준다', async () => {
    const s = await newSession()
    await appendMessage(db, clock, { sessionId: s, role: 'user', kind: 'chat', bodyMd: '질문' })
    const { materialId, problemIds: [p] } = await insertMaterial(db, clock, { sessionId: s, parentId: null, requestId: 'r', gen: gen('A', 1) })
    await appendMessage(db, clock, { sessionId: s, role: 'assistant', kind: 'material', bodyMd: '자료', materialId })
    const sub = await insertSubmission(db, clock, {
      problemId: p, answer: 'print(1)', language: 'python', feedbackMode: 'errors-only',
      feedback: { verdict: 'incorrect', summary_md: 's' }, verdict: 'incorrect', requestId: 'r2',
    })
    expect(sub.attemptNo).toBe(1)
    expect((await insertSubmission(db, clock, {
      problemId: p, answer: 'x', language: null, feedbackMode: 'full',
      feedback: {}, verdict: 'partial', requestId: 'r3',
    })).attemptNo).toBe(2)

    const view = (await loadSessionView(db, s))!
    expect(view.session.mode).toBe('coding')
    expect(view.messages.map((m) => m.bodyMd)).toEqual(['질문', '자료'])
    expect(view.materials[0].title).toBe('A')
    expect(view.submissions[p].map((x) => x.attemptNo)).toEqual([1, 2])
    expect(view.submissions[p][0].feedback.summary_md).toBe('s')
  })

  it('없는 세션은 null 이다', async () => {
    expect(await loadSessionView(db, 999)).toBeNull()
  })

  it('최근 세션은 갱신 시각 내림차순이다', async () => {
    const a = await newSession('A')
    clock.advance(1000)
    const b = await newSession('B')
    clock.advance(1000)
    await appendMessage(db, clock, { sessionId: a, role: 'user', kind: 'chat', bodyMd: 'x' })
    const list = await listRecentSessions(db)
    expect(list.map((x) => x.id)).toEqual([a, b])
  })
})
