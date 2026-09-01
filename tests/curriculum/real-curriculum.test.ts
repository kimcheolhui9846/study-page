import { describe, it, expect, beforeEach } from 'vitest'
import { loadGraph, resetGraphCache } from '../../lib/curriculum/load'
import { ancestorsOf, topicsFor, topicsOfSubject } from '../../lib/curriculum/graph'
import { SUBJECTS } from '../../lib/curriculum/schema'

/**
 * 실제 레포의 커리큘럼 파일을 읽는다.
 *
 * Topic 을 추가하다 오타를 내면 여기가 먼저 빨개진다 — 화면에서
 * "진도가 안 나가는데 이유를 모르겠다"가 되기 전에 잡는다.
 */
beforeEach(() => resetGraphCache())

describe('실제 커리큘럼', () => {
  it('★ 그래프가 선다 — 사이클·오타·중복이 없다', () => {
    expect(() => loadGraph()).not.toThrow()
  })

  it('세 과목이 모두 있다', () => {
    const g = loadGraph()
    for (const s of SUBJECTS) {
      expect(topicsOfSubject(g, s).length, `${s} 에 Topic 이 없다`).toBeGreaterThan(0)
    }
  })

  it('모든 Topic 이 goal 과 keywords 를 갖는다 — 채점 기준의 앵커다', () => {
    for (const t of loadGraph().topics.values()) {
      expect(t.goal.length, `${t.id} 의 goal 이 비었다`).toBeGreaterThan(5)
      expect(t.keywords.length, `${t.id} 의 keywords 가 비었다`).toBeGreaterThan(0)
    }
  })

  it('★ 수학 기초 보충은 전부 optional 이다 — 본선이 아니다', () => {
    const g = loadGraph()
    const foundation = [...g.topics.values()].filter((t) => t.domain === 'foundation')

    expect(foundation.length).toBeGreaterThan(0)
    for (const t of foundation) {
      expect(t.required, `${t.id} 가 본선에 있다`).toBe('optional')
    }
  })

  it('★ 기초 보충은 remediation 으로만 도달 가능하다', () => {
    const g = loadGraph()
    const foundationIds = new Set(
      [...g.topics.values()].filter((t) => t.domain === 'foundation').map((t) => t.id),
    )

    // 본선 Topic 이 기초 보충을 선수로 갖고 있으면 안 된다.
    // 그러면 "필요할 때만"이 아니라 항상 하게 된다.
    // (기초 보충끼리 선수 관계를 갖는 것은 정상이다)
    for (const t of g.topics.values()) {
      if (foundationIds.has(t.id)) continue
      for (const p of t.prerequisites) {
        expect(foundationIds.has(p), `${t.id} 가 기초 보충 ${p} 를 선수로 갖는다`).toBe(false)
      }
    }

    // 대신 remediation 으로는 가리켜야 한다 — 아니면 영원히 안 쓰인다
    const referenced = new Set(
      [...g.topics.values()].flatMap((t) => t.remediation).filter((id) => foundationIds.has(id)),
    )
    expect(referenced.size, '기초 보충을 가리키는 remediation 이 하나도 없다').toBeGreaterThan(0)
  })

  it('★ 과목을 넘는 선수 관계가 실제로 있다', () => {
    const g = loadGraph()
    const crossing = [...g.topics.values()].flatMap((t) =>
      t.prerequisites
        .filter((p) => g.topics.get(p)!.subject !== t.subject)
        .map((p) => `${p} → ${t.id}`),
    )
    expect(crossing.length, '과목 간 선수 관계가 없다').toBeGreaterThan(0)
  })

  it('★ 역전파는 수학 선수를 거쳐야만 열린다', () => {
    const g = loadGraph()
    const ancestors = ancestorsOf(g, 'cs.dl.backpropagation')

    expect(ancestors).toContain('math.calc.chain-rule')
    expect(ancestors).toContain('math.la.matrix-ops')
    expect(ancestors).toContain('cs.ml.linear-regression')
  })

  it('위상 정렬에서 수학 선수가 CS 후속보다 앞에 온다', () => {
    const g = loadGraph()
    expect(g.order.indexOf('math.calc.chain-rule'))
      .toBeLessThan(g.order.indexOf('cs.dl.backpropagation'))
  })

  it('★ 목표 기간이 담는 범위가 달라진다', () => {
    const g = loadGraph()
    const d30 = topicsFor(g, 30).length
    const d60 = topicsFor(g, 60).length
    const d90 = topicsFor(g, 90).length

    expect(d30).toBeLessThan(d60)
    expect(d60).toBeLessThanOrEqual(d90)
    expect(d90).toBe(g.topics.size) // 90일은 전부 담는다
  })

  it('★ 30일 과정에 선수 구멍이 없다 — core 의 선수는 core 여야 한다', () => {
    const g = loadGraph()
    const core = new Set(topicsFor(g, 30).map((t) => t.id))

    for (const id of core) {
      for (const p of g.topics.get(id)!.prerequisites) {
        expect(core.has(p), `core 인 ${id} 의 선수 ${p} 가 core 가 아니다`).toBe(true)
      }
    }
  })

  it('연결이 세 과목을 실제로 잇는다', () => {
    const g = loadGraph()
    const subjectsInLinks = new Set(
      g.links.flatMap((l) => [g.topics.get(l.from)!.subject, g.topics.get(l.to)!.subject]),
    )
    expect(subjectsInLinks.size).toBeGreaterThanOrEqual(2)
  })

  it('두 번 불러도 같은 그래프다 — 캐시가 순서를 흔들지 않는다', () => {
    const first = loadGraph().order
    resetGraphCache()
    expect(loadGraph().order).toEqual(first)
  })
})
