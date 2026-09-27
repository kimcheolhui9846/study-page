import type { CurriculumGraph, TopicNode } from '../curriculum/graph'
import type { TopicKind } from '../curriculum/schema'
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
  /**
   * ★ Topic 의 성격. 커리큘럼 파일의 `kind` 다.
   *
   * 어휘 Topic 을 개념 Topic 처럼 가르치면 「일반 학술 어휘」에 대한
   * 700자짜리 한국어 설명문이 나온다. 단어 공부가 아니다.
   */
  kind: TopicKind
  /** 오늘 이걸 왜 하는가 — 신규 · 복습 · 보충. Topic 의 성격과 다른 축이다 */
  mode: PlanItemKind
  /** 커리큘럼이 지정한 문제 유형. 없으면 성격의 기본 유형을 쓴다 */
  questionTypes: string[]
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
    /** 오늘 이걸 왜 하는가. Topic 의 성격(`topic.kind`)과 다른 축이다 */
    mode: PlanItemKind
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
    kind: topic.kind,
    mode: args.mode,
    questionTypes: topic.questionTypes,
    reviewRound: args.reviewRound,
    alreadyLearned,
    weakConcepts: args.progress.get(topic.id)?.weakConcepts ?? [],
    forbidden,
    connections,
  }
}

/**
 * Topic 의 성격을 사람 말로. 모델은 `vocabulary` 라는 낱말이 아니라
 * 무엇을 만들어야 하는지를 알아야 한다.
 */
const KIND_LABEL: Record<TopicKind, string> = {
  concept: '개념 학습',
  vocabulary: '어휘 학습',
  reading: '독해',
  practice: '문제 풀이',
}

/**
 * 문제 유형 슬러그를 지시문으로 옮긴다.
 *
 * 커리큘럼은 `vocab-paper` 같은 슬러그로 적는다 — 사람이 쓰고 읽기 위한
 * 것이다. 모델에게 슬러그를 그대로 주면 아무 뜻도 없다.
 *
 * ★ 모르는 슬러그를 조용히 버린다. 그래서 테스트가 커리큘럼에 실제로 쓰인
 * 값을 전부 훑어 여기 있는지 확인한다 — 오타가 나면 그 Topic 만 조용히
 * 유형 지시를 잃는데, 그건 눈에 안 띈다.
 */
const QUESTION_TYPE: Record<string, string> = {
  'vocab-context': '단어가 문맥에서 어떤 뜻으로 쓰였는지 묻는다',
  'vocab-paper': '논문에 나올 법한 문장을 주고 그 안에서의 쓰임을 묻는다',
  comprehension: '지문의 내용을 제대로 읽었는지 묻는다',
  'structure-analysis': '문장의 구조를 나누어 분석하게 한다',
  summary: '읽은 것을 자기 말로 요약하게 한다',
  'situation-response': '상황을 주고 영어로 답하게 한다',
  write: '영어로 직접 쓰게 한다',
  rewrite: '주어진 문장을 고쳐 쓰게 한다',
  notation: '기호와 표기를 정확히 쓰게 한다',
  explain: '왜 그런지 설명하게 한다',
  concept: '개념의 정의와 경계를 묻는다',
  // 연습 Topic 용. 설명이 아니라 손으로 풀어 답이 나오는 것을 묻는다.
  calculation: '직접 계산해서 답을 내게 한다. 답만이 아니라 과정도 쓰게 한다',
  procedure: '푸는 절차를 순서대로 쓰게 한다',
}

/** 커리큘럼이 쓰는 문제 유형 슬러그. 테스트가 이걸로 커리큘럼을 검사한다. */
export function knownQuestionTypes(): Set<string> {
  return new Set(Object.keys(QUESTION_TYPE))
}

/** 컨텍스트를 사용자 메시지로 편다. 빈 항목은 줄을 만들지 않는다. */
export function contextToMessage(ctx: TopicContext): string {
  const lines = [
    `과목: ${ctx.subject}`,
    `영역: ${ctx.domainLabel}`,
    `주제: ${ctx.title}`,
    `학습 목표: ${ctx.goal}`,
    `성격: ${KIND_LABEL[ctx.kind]}`,
    `다뤄야 할 키워드: ${ctx.keywords.join(', ')}`,
    `난이도: ${ctx.difficulty} / 5`,
    `분량: ${ctx.minutes}분`,
  ]

  const types = ctx.questionTypes.map((t) => QUESTION_TYPE[t]).filter((t) => t !== undefined)
  if (types.length > 0) {
    lines.push(`문제는 이렇게 낸다: ${types.join(' / ')}`)
  }

  if (ctx.mode === 'review' && ctx.reviewRound !== null) {
    lines.push(`이번은 복습 ${ctx.reviewRound}회차다. 처음부터 다시 설명하지 말고 핵심만 되짚어라.`)
  }
  if (ctx.mode === 'remediation') {
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
