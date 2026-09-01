import { describe, it, expect } from 'vitest'
import {
  buildGraph, CurriculumError, ancestorsOf, descendantsOf,
  includedLevels, topicsFor, topicsOfSubject,
} from '../../lib/curriculum/graph'
import { DomainFileSchema, type DomainFile } from '../../lib/curriculum/schema'

/** 최소 필드만 주고 나머지는 zod 기본값에 맡긴다 — 기본값도 함께 검증된다. */
function topic(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    goal: `${id} 를 설명한다`,
    difficulty: 2,
    estimatedMinutes: 20,
    keywords: ['키워드'],
    ...over,
  }
}

function domain(
  subject: string, name: string, topics: Array<Record<string, unknown>>,
  over: Record<string, unknown> = {},
): DomainFile {
  return DomainFileSchema.parse({
    subject,
    domain: name,
    label: name,
    modules: [{ id: 'm1', label: '모듈', topics }],
    ...over,
  })
}

describe('buildGraph', () => {
  it('Topic 을 담고 도메인 정보를 붙인다', () => {
    const g = buildGraph([domain('math', 'la', [topic('math.la.a')])])
    const t = g.topics.get('math.la.a')!
    expect(t.subject).toBe('math')
    expect(t.domain).toBe('la')
    expect(t.moduleLabel).toBe('모듈')
  })

  it('zod 기본값이 채워진다', () => {
    const g = buildGraph([domain('math', 'la', [topic('math.la.a')])])
    const t = g.topics.get('math.la.a')!
    expect(t.required).toBe('core')
    expect(t.kind).toBe('concept')
    expect(t.passThreshold).toBe(75)
    expect(t.reviewIntervals).toEqual([1, 3, 7, 14])
  })

  it('★ ID 가 중복이면 던진다', () => {
    expect(() => buildGraph([
      domain('math', 'la', [topic('math.la.a'), topic('math.la.a')]),
    ])).toThrow(CurriculumError)
  })

  it('★ ID 접두사가 파일의 subject 와 다르면 던진다 — 복사-붙여넣기 실수', () => {
    expect(() => buildGraph([domain('math', 'la', [topic('cs.la.a')])]))
      .toThrow(/접두사/)
  })

  it('★ 없는 선수 Topic 을 가리키면 던진다 — 오타가 Topic 을 영원히 막는다', () => {
    expect(() => buildGraph([
      domain('math', 'la', [topic('math.la.b', { prerequisites: ['math.la.없음'] })]),
    ])).toThrow(/선수 Topic/)
  })

  it('★ 없는 보충 Topic 을 가리켜도 던진다', () => {
    expect(() => buildGraph([
      domain('math', 'la', [topic('math.la.b', { remediation: ['math.la.없음'] })]),
    ])).toThrow(/보충 Topic/)
  })

  it('★ 사이클이 있으면 던진다 — 그 Topic 들은 영원히 안 열린다', () => {
    expect(() => buildGraph([
      domain('math', 'la', [
        topic('math.la.a', { prerequisites: ['math.la.b'] }),
        topic('math.la.b', { prerequisites: ['math.la.a'] }),
      ]),
    ])).toThrow(/사이클/)
  })

  it('연결이 없는 Topic 을 가리키면 던진다', () => {
    expect(() => buildGraph(
      [domain('math', 'la', [topic('math.la.a')])],
      [{ from: 'math.la.a', to: 'cs.dl.없음', kind: 'enables', note: '' }],
    )).toThrow(/연결이 가리키는/)
  })
})

describe('위상 정렬', () => {
  it('선수가 항상 앞에 온다', () => {
    const g = buildGraph([
      domain('math', 'la', [
        topic('math.la.c', { prerequisites: ['math.la.b'] }),
        topic('math.la.b', { prerequisites: ['math.la.a'] }),
        topic('math.la.a'),
      ]),
    ])
    expect(g.order).toEqual(['math.la.a', 'math.la.b', 'math.la.c'])
  })

  it('★ 과목을 넘는 선수 관계도 순서를 지킨다', () => {
    const g = buildGraph([
      domain('math', 'la', [topic('math.la.matrix')]),
      domain('cs', 'ml', [topic('cs.ml.linear', { prerequisites: ['math.la.matrix'] })]),
    ])
    expect(g.order.indexOf('math.la.matrix')).toBeLessThan(g.order.indexOf('cs.ml.linear'))
  })

  it('★ 같은 조건이면 항상 같은 순서다 — 화면이 새로고침마다 흔들리면 안 된다', () => {
    const files = [
      domain('math', 'la', [topic('math.la.b'), topic('math.la.a')], { order: 1 }),
      domain('cs', 'ds', [topic('cs.ds.a')], { order: 0 }),
    ]
    const first = buildGraph(files).order
    const second = buildGraph([...files].reverse()).order
    expect(first).toEqual(second)
  })

  it('난이도가 낮은 것이 먼저 온다', () => {
    const g = buildGraph([
      domain('math', 'la', [
        topic('math.la.hard', { difficulty: 5 }),
        topic('math.la.easy', { difficulty: 1 }),
      ]),
    ])
    expect(g.order.indexOf('math.la.easy')).toBeLessThan(g.order.indexOf('math.la.hard'))
  })
})

describe('dependents — next 를 파일에 적지 않고 유도한다', () => {
  it('역방향 간선을 만든다', () => {
    const g = buildGraph([
      domain('math', 'la', [
        topic('math.la.a'),
        topic('math.la.b', { prerequisites: ['math.la.a'] }),
        topic('math.la.c', { prerequisites: ['math.la.a'] }),
      ]),
    ])
    expect(g.dependents.get('math.la.a')!.sort()).toEqual(['math.la.b', 'math.la.c'])
    expect(g.dependents.get('math.la.b')).toEqual([])
  })
})

describe('ancestorsOf / descendantsOf', () => {
  const g = buildGraph([
    domain('math', 'la', [
      topic('math.la.a'),
      topic('math.la.b', { prerequisites: ['math.la.a'] }),
      topic('math.la.c', { prerequisites: ['math.la.b'] }),
    ]),
  ])

  it('간접 선수까지 모은다', () => {
    expect(ancestorsOf(g, 'math.la.c').sort()).toEqual(['math.la.a', 'math.la.b'])
  })

  it('간접 후속까지 모은다 — 이 Topic 이 막고 있는 것', () => {
    expect(descendantsOf(g, 'math.la.a').sort()).toEqual(['math.la.b', 'math.la.c'])
  })

  it('뿌리는 선수가 없고 잎은 후속이 없다', () => {
    expect(ancestorsOf(g, 'math.la.a')).toEqual([])
    expect(descendantsOf(g, 'math.la.c')).toEqual([])
  })
})

describe('목표 기간이 담는 수준', () => {
  it('30일은 core 만, 60일은 +recommended, 90일은 전부', () => {
    expect([...includedLevels(30)]).toEqual(['core'])
    expect([...includedLevels(60)].sort()).toEqual(['core', 'recommended'])
    expect([...includedLevels(90)].sort()).toEqual(['core', 'optional', 'recommended'])
  })

  it('★ 기간을 바꿔도 그래프는 그대로다. 선택 범위만 바뀐다', () => {
    const g = buildGraph([
      domain('math', 'la', [
        topic('math.la.core'),
        topic('math.la.rec', { required: 'recommended' }),
        topic('math.la.opt', { required: 'optional' }),
      ]),
    ])
    expect(g.topics.size).toBe(3) // 그래프는 항상 전부 담는다

    expect(topicsFor(g, 30).map((t) => t.id)).toEqual(['math.la.core'])
    expect(topicsFor(g, 60)).toHaveLength(2)
    expect(topicsFor(g, 90)).toHaveLength(3)
  })
})

describe('topicsOfSubject', () => {
  it('과목별로 걸러도 순서를 지킨다', () => {
    const g = buildGraph([
      domain('math', 'la', [topic('math.la.a'), topic('math.la.b', { prerequisites: ['math.la.a'] })]),
      domain('cs', 'ds', [topic('cs.ds.a')]),
    ])
    expect(topicsOfSubject(g, 'math').map((t) => t.id)).toEqual(['math.la.a', 'math.la.b'])
    expect(topicsOfSubject(g, 'cs').map((t) => t.id)).toEqual(['cs.ds.a'])
  })
})
