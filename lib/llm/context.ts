import type { CurriculumGraph, TopicNode } from '../curriculum/graph'
import type { PlanItemKind, ProgressState } from '../plan/types'

/**
 * 계획 항목 하나를 GPT 컨텍스트 하나로 바꾼다.
 *
 * ★ 커리큘럼 그래프가 프롬프트로 흘러드는 유일한 지점이다. 모델은 그래프를
 * 모르고, 이 함수가 골라준 것만 본다.
 */

export interface TopicContext {
  topicId: string
  subject: string
  domainLabel: string
  title: string
  goal: string
  keywords: string[]
  difficulty: number
  minutes: number
  kind: PlanItemKind
  reviewRound: number | null

  /** 이미 넘긴 선수. 다시 설명하느라 분량을 낭비하지 않게 한다 */
  alreadyLearned: string[]
  /** 이 Topic 에서 반복해 틀린 개념 */
  weakConcepts: string[]
  /**
   * ★ 아직 배우지 않은 후속 개념의 키워드.
   *
   * 이게 없으면 GPT 가 Day 3 에서 트랜스포머를 꺼낸다. 커리큘럼의 순서를
   * 프롬프트가 지키게 하는 유일한 장치다.
   */
  forbidden: string[]
  /** 왜 이걸 배우나. `_links.yaml` 의 과목 간 연결 */
  connections: string[]
}

/** 프롬프트가 비대해지지 않게 자른다. 자를 땐 가까운 것부터 남는다. */
const MAX_LEARNED = 8
const MAX_FORBIDDEN = 12
/** 이 점수를 넘겼으면 "안다"고 본다. transition.ts 의 advances 기준과 같다 */
const KNOWN = 60

/**
 * 그래프 거리순으로 훑는다.
 *
 * ancestorsOf/descendantsOf 는 DFS 라 순서가 거리와 무관하다. 목록을 자를 때
 * 먼 것이 남고 가까운 것이 잘리면 안 되므로 여기서는 BFS 로 돈다.
 */
function byDistance(edges: Map<string, string[]>, from: string): string[] {
  const seen = new Set<string>()
  let frontier = edges.get(from) ?? []

  const out: string[] = []
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id) || id === from) continue
      seen.add(id)
      out.push(id)
      next.push(...(edges.get(id) ?? []))
    }
    frontier = next
  }
  return out
}

function prerequisiteEdges(graph: CurriculumGraph): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const [id, t] of graph.topics) m.set(id, t.prerequisites)
  return m
}

export function buildTopicContext(
  graph: CurriculumGraph,
  topic: TopicNode,
  args: {
    kind: PlanItemKind
    reviewRound: number | null
    minutes: number
    progress: Map<string, ProgressState>
  },
): TopicContext {
  const known = (id: string) => (args.progress.get(id)?.masteryScore ?? 0) >= KNOWN

  const alreadyLearned = byDistance(prerequisiteEdges(graph), topic.id)
    .filter(known)
    .map((id) => graph.topics.get(id)!.title)
    .slice(0, MAX_LEARNED)

  const forbidden: string[] = []
  const taken = new Set(topic.keywords)
  for (const id of byDistance(graph.dependents, topic.id)) {
    if (known(id)) continue // 이미 아는 건 금지할 이유가 없다
    for (const k of graph.topics.get(id)!.keywords) {
      if (taken.has(k)) continue
      taken.add(k)
      forbidden.push(k)
      if (forbidden.length >= MAX_FORBIDDEN) break
    }
    if (forbidden.length >= MAX_FORBIDDEN) break
  }

  const connections = graph.links
    .filter((l) => (l.from === topic.id || l.to === topic.id) && l.note !== '')
    .map((l) => l.note)

  return {
    topicId: topic.id,
    subject: topic.subject,
    domainLabel: topic.domainLabel,
    title: topic.title,
    goal: topic.goal,
    keywords: topic.keywords,
    difficulty: topic.difficulty,
    minutes: args.minutes,
    kind: args.kind,
    reviewRound: args.reviewRound,
    alreadyLearned,
    weakConcepts: args.progress.get(topic.id)?.weakConcepts ?? [],
    forbidden,
    connections,
  }
}

/** 컨텍스트를 사용자 메시지로 편다. 빈 항목은 줄을 만들지 않는다. */
export function contextToMessage(ctx: TopicContext): string {
  const lines = [
    `과목: ${ctx.subject}`,
    `영역: ${ctx.domainLabel}`,
    `주제: ${ctx.title}`,
    `학습 목표: ${ctx.goal}`,
    `다뤄야 할 키워드: ${ctx.keywords.join(', ')}`,
    `난이도: ${ctx.difficulty} / 5`,
    `분량: ${ctx.minutes}분`,
  ]

  if (ctx.kind === 'review' && ctx.reviewRound !== null) {
    lines.push(`이번은 복습 ${ctx.reviewRound}회차다. 처음부터 다시 설명하지 말고 핵심만 되짚어라.`)
  }
  if (ctx.kind === 'remediation') {
    lines.push('이번은 보충이다. 이 개념이 선수로 막고 있어 앞으로 못 나가는 상태다.')
  }
  if (ctx.alreadyLearned.length > 0) {
    lines.push(`이미 배운 것 (다시 설명하지 마라): ${ctx.alreadyLearned.join(', ')}`)
  }
  if (ctx.forbidden.length > 0) {
    lines.push(`아직 배우지 않은 것 (쓰지 마라): ${ctx.forbidden.join(', ')}`)
  }
  if (ctx.weakConcepts.length > 0) {
    lines.push(`이 학습자가 반복해 틀린 것: ${ctx.weakConcepts.join(', ')}`)
  }
  for (const note of ctx.connections) {
    lines.push(`AI 와의 연결: ${note}`)
  }

  return lines.join('\n')
}
