import { describe, it, expect } from 'vitest'
import { loadGraph } from '../../lib/curriculum/load'
import { buildTopicContext, contextToMessage } from '../../lib/llm/context'
import type { PlanItemKind, ProgressState } from '../../lib/plan/types'

const graph = loadGraph()

function progress(entries: Array<{ id: string; score: number; weak?: string[] }>) {
  const m = new Map<string, ProgressState>()
  for (const e of entries) {
    m.set(e.id, {
      topicId: e.id, status: 'mastered', masteryScore: e.score, attemptCount: 1, wrongCount: 0,
      nextReviewAt: null, reviewRound: 0, lastStudiedAt: null, weakConcepts: e.weak ?? [],
    })
  }
  return m
}

function ctxFor(
  topicId: string,
  p: Map<string, ProgressState> = new Map(),
  over: Partial<{ kind: PlanItemKind; reviewRound: number | null; minutes: number }> = {},
) {
  return buildTopicContext(graph, graph.topics.get(topicId)!, {
    kind: 'new', reviewRound: null, minutes: 25, progress: p, ...over,
  })
}

describe('컨텍스트 조립', () => {
  it('Topic 의 메타데이터를 담는다', () => {
    const ctx = ctxFor('cs.prog.variables-types')
    expect(ctx.title.length).toBeGreaterThan(0)
    expect(ctx.goal.length).toBeGreaterThan(5)
    expect(ctx.keywords.length).toBeGreaterThan(0)
    expect(ctx.minutes).toBe(25)
  })

  it('★ 아직 안 배운 후속의 키워드를 금지어로 넘긴다', () => {
    const ctx = ctxFor('cs.prog.variables-types')
    const arrayKeywords = graph.topics.get('cs.ds.array')!.keywords
    expect(ctx.forbidden.some((k) => arrayKeywords.includes(k))).toBe(true)
  })

  it('★ 이미 배운 후속은 금지어에서 빠진다', () => {
    // 후속 전부를 넘겼으면 금지할 것이 없다
    const all = [...graph.dependents.keys()].map((id) => ({ id, score: 90 }))
    const ctx = ctxFor('cs.prog.variables-types', progress(all))
    expect(ctx.forbidden).toEqual([])
  })

  it('선행 Topic 은 금지어가 아니다 — 뒤가 아니라 앞이다', () => {
    const ctx = ctxFor('cs.ds.array')
    const prereqKeywords = graph.topics.get('cs.prog.variables-types')!.keywords
      .filter((k) => !graph.topics.get('cs.ds.array')!.keywords.includes(k))
    for (const k of prereqKeywords) expect(ctx.forbidden).not.toContain(k)
  })

  it('자기 키워드는 금지어가 아니다', () => {
    for (const id of graph.order) {
      const ctx = ctxFor(id)
      for (const k of ctx.keywords) expect(ctx.forbidden).not.toContain(k)
    }
  })

  it('★ 금지어는 가까운 후속부터 채운다 — 잘려도 바로 다음 것이 남게', () => {
    const ctx = ctxFor('cs.prog.variables-types')
    const direct = new Set(
      graph.dependents.get('cs.prog.variables-types')!
        .flatMap((id) => graph.topics.get(id)!.keywords),
    )
    // 첫 금지어는 직속 후속에서 온다
    expect(direct.has(ctx.forbidden[0]!)).toBe(true)
  })

  it('★ 넘긴 선수를 "이미 배운 것"으로 넘긴다', () => {
    const p = progress([{ id: 'cs.prog.variables-types', score: 90 }])
    const ctx = ctxFor('cs.ds.array', p)
    expect(ctx.alreadyLearned).toContain(graph.topics.get('cs.prog.variables-types')!.title)
  })

  it('못 넘긴 선수는 "이미 배운 것"이 아니다', () => {
    const p = progress([{ id: 'cs.prog.variables-types', score: 30 }])
    const ctx = ctxFor('cs.ds.array', p)
    expect(ctx.alreadyLearned).toEqual([])
  })

  it('취약 개념을 그대로 싣는다', () => {
    const p = progress([{ id: 'cs.ds.array', score: 40, weak: ['인덱스는 0부터'] }])
    const ctx = ctxFor('cs.ds.array', p)
    expect(ctx.weakConcepts).toEqual(['인덱스는 0부터'])
  })

  it('★ 과목을 넘는 연결을 담는다 — 왜 이걸 배우나', () => {
    const ctx = ctxFor('cs.dl.backpropagation')
    expect(ctx.connections.join(' ')).toContain('연쇄법칙')
  })

  it('연결이 없는 Topic 은 빈 배열이다', () => {
    expect(ctxFor('cs.prog.variables-types').connections).toEqual([])
  })

  it('목록이 무한정 길어지지 않는다', () => {
    for (const id of graph.order) {
      const ctx = ctxFor(id)
      expect(ctx.forbidden.length).toBeLessThanOrEqual(12)
      expect(ctx.alreadyLearned.length).toBeLessThanOrEqual(8)
    }
  })

  it('모든 Topic 에 대해 조립이 터지지 않는다', () => {
    for (const id of graph.order) expect(() => ctxFor(id)).not.toThrow()
  })
})

describe('메시지 조립', () => {
  it('빈 항목은 줄을 만들지 않는다', () => {
    const msg = contextToMessage(ctxFor('cs.prog.variables-types'))
    expect(msg).not.toContain('이 학습자가 반복해 틀린 것')
    expect(msg).not.toContain('이미 배운 것')
  })

  it('★ 금지어를 명시적으로 말한다', () => {
    const msg = contextToMessage(ctxFor('cs.prog.variables-types'))
    expect(msg).toContain('아직 배우지 않은 것 (쓰지 마라)')
  })

  it('복습이면 회차를 말하고 처음부터 설명하지 말라고 한다', () => {
    const msg = contextToMessage(ctxFor('cs.ds.array', new Map(), { kind: 'review', reviewRound: 2 }))
    expect(msg).toContain('복습 2회차')
    expect(msg).toContain('처음부터 다시 설명하지 말고')
  })

  it('보충이면 왜 보충인지 말한다', () => {
    const msg = contextToMessage(ctxFor('cs.ds.array', new Map(), { kind: 'remediation' }))
    expect(msg).toContain('보충이다')
  })

  it('신규면 복습·보충 문구가 없다', () => {
    const msg = contextToMessage(ctxFor('cs.ds.array'))
    expect(msg).not.toContain('회차')
    expect(msg).not.toContain('보충이다')
  })
})
