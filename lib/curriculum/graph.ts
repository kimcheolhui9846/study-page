import type { DomainFile, Link, Subject, Topic } from './schema'

/**
 * Topic 그래프.
 *
 * 파일 읽기를 모른다 — `DomainFile[]` 을 받아 순수하게 조립한다.
 * 그래서 가짜 커리큘럼으로 전부 테스트할 수 있다.
 */

export interface TopicNode extends Topic {
  subject: Subject
  domain: string
  domainLabel: string
  domainOrder: number
  moduleId: string
  moduleLabel: string
}

export interface CurriculumGraph {
  topics: Map<string, TopicNode>
  /** 위상 정렬 순서. 선수가 항상 앞에 온다. */
  order: string[]
  /** 역방향 간선. `next` 를 파일에 적지 않고 여기서 유도한다. */
  dependents: Map<string, string[]>
  links: Link[]
}

export class CurriculumError extends Error {}

/**
 * 그래프를 만들고 그 자리에서 검증한다.
 *
 * 검증을 나중으로 미루지 않는다 — 깨진 그래프로 계획을 세우면
 * 조용히 이상한 순서로 공부하게 된다. 부팅에서 크게 실패하는 편이 낫다.
 */
export function buildGraph(files: DomainFile[], links: Link[] = []): CurriculumGraph {
  const topics = new Map<string, TopicNode>()

  for (const file of files) {
    for (const mod of file.modules) {
      for (const topic of mod.topics) {
        if (topics.has(topic.id)) {
          throw new CurriculumError(`Topic ID 가 중복입니다: ${topic.id}`)
        }
        // ID 의 첫 조각이 파일의 subject 와 달라지면 복사-붙여넣기 실수다.
        // 그대로 두면 진도가 엉뚱한 과목에 붙는다.
        const prefix = topic.id.split('.')[0]
        if (prefix !== file.subject) {
          throw new CurriculumError(
            `${topic.id} 의 ID 접두사가 '${prefix}' 인데 파일의 subject 는 '${file.subject}' 입니다`,
          )
        }
        topics.set(topic.id, {
          ...topic,
          subject: file.subject,
          domain: file.domain,
          domainLabel: file.label,
          domainOrder: file.order,
          moduleId: mod.id,
          moduleLabel: mod.label,
        })
      }
    }
  }

  // 참조가 실제로 존재하는지 — 오타 하나가 Topic 을 영원히 안 열리게 만든다
  for (const t of topics.values()) {
    for (const p of t.prerequisites) {
      if (!topics.has(p)) {
        throw new CurriculumError(`${t.id} 의 선수 Topic '${p}' 가 없습니다`)
      }
    }
    for (const r of t.remediation) {
      if (!topics.has(r)) {
        throw new CurriculumError(`${t.id} 의 보충 Topic '${r}' 가 없습니다`)
      }
    }
  }

  for (const link of links) {
    for (const end of [link.from, link.to]) {
      if (!topics.has(end)) {
        throw new CurriculumError(`연결이 가리키는 Topic '${end}' 가 없습니다`)
      }
    }
  }

  // 역방향 간선을 먼저 만든다. 위상 정렬이 이걸 재사용하므로
  // 매번 전체를 훑지 않는다.
  const dependents = new Map<string, string[]>()
  for (const id of topics.keys()) dependents.set(id, [])
  for (const t of topics.values()) {
    for (const p of t.prerequisites) dependents.get(p)!.push(t.id)
  }

  const order = topologicalOrder(topics, dependents)

  return { topics, order, dependents, links }
}

/**
 * 위상 정렬. 사이클이 있으면 던진다.
 *
 * 사이클은 "A 를 알아야 B 를 알고 B 를 알아야 A 를 안다"는 뜻이라
 * 그 Topic 들은 영원히 열리지 않는다. 조용히 두면 사용자는 이유도 모른 채
 * 진도가 막힌다.
 */
function topologicalOrder(
  topics: Map<string, TopicNode>,
  dependents: Map<string, string[]>,
): string[] {
  const indegree = new Map<string, number>()
  for (const [id, t] of topics) indegree.set(id, t.prerequisites.length)

  // 같은 조건이면 항상 같은 순서가 나오게 정렬해 둔다.
  // 그래야 화면의 Day 목록이 새로고침마다 흔들리지 않는다.
  const byStableOrder = (a: string, b: string) => {
    const ta = topics.get(a)!
    const tb = topics.get(b)!
    return (
      ta.domainOrder - tb.domainOrder ||
      ta.difficulty - tb.difficulty ||
      a.localeCompare(b)
    )
  }

  const ready = [...indegree].filter(([, n]) => n === 0).map(([id]) => id).sort(byStableOrder)
  const out: string[] = []

  while (ready.length > 0) {
    const id = ready.shift()!
    out.push(id)

    for (const next of dependents.get(id) ?? []) {
      const left = indegree.get(next)! - 1
      indegree.set(next, left)
      if (left === 0) {
        ready.push(next)
        ready.sort(byStableOrder)
      }
    }
  }

  if (out.length !== topics.size) {
    const stuck = [...topics.keys()].filter((id) => !out.includes(id))
    throw new CurriculumError(
      `선수 관계에 사이클이 있습니다. 갇힌 Topic: ${stuck.slice(0, 5).join(', ')}`,
    )
  }
  return out
}

/** 이 Topic 을 열려면 먼저 알아야 하는 것 전부 (간접 포함). */
export function ancestorsOf(graph: CurriculumGraph, id: string): string[] {
  const seen = new Set<string>()
  const stack = [...(graph.topics.get(id)?.prerequisites ?? [])]

  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(graph.topics.get(cur)?.prerequisites ?? []))
  }
  return [...seen]
}

/** 이 Topic 이 막고 있는 것 전부 (간접 포함). 우선순위 계산이 쓴다. */
export function descendantsOf(graph: CurriculumGraph, id: string): string[] {
  const seen = new Set<string>()
  const stack = [...(graph.dependents.get(id) ?? [])]

  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(graph.dependents.get(cur) ?? []))
  }
  return [...seen]
}

/** 목표 기간이 담을 수 있는 수준. 그래프는 그대로고 선택 범위만 바뀐다. */
export function includedLevels(targetDayCount: number): Set<string> {
  if (targetDayCount <= 30) return new Set(['core'])
  if (targetDayCount <= 60) return new Set(['core', 'recommended'])
  return new Set(['core', 'recommended', 'optional'])
}

export function topicsFor(graph: CurriculumGraph, targetDayCount: number): TopicNode[] {
  const levels = includedLevels(targetDayCount)
  return graph.order
    .map((id) => graph.topics.get(id)!)
    .filter((t) => levels.has(t.required))
}

export function topicsOfSubject(graph: CurriculumGraph, subject: Subject): TopicNode[] {
  return graph.order.map((id) => graph.topics.get(id)!).filter((t) => t.subject === subject)
}
