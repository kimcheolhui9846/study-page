import { and, eq } from 'drizzle-orm'
import { reviewItems, topicContents } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import type { CurriculumGraph, TopicNode } from '../curriculum/graph'
import type { ProgressState } from '../plan/types'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import { MODEL } from './pricing'
import { buildTopicContext } from './context'
import { contentSystem, REVIEW_SYSTEM, contentUserMessage } from './prompts'
import {
  CONTENT_JSON_SCHEMA, REVIEW_JSON_SCHEMA,
  ContentSchema, ReviewSchema, StoredContentSchema, StoredReviewSchema,
  materialOfContent, materialOfReview,
  type StudyMaterial,
} from './schemas'
import type { LlmClient } from './types'

/**
 * 학습 자료를 확보한다. 이미 있으면 만들지 않는다.
 *
 * ★ 비용 방어 4겹 중 ②·③이 여기 있다.
 *   ② 멱등성 — topic_contents(topic_id) · review_items(topic_id, round) 의 UNIQUE.
 *      같은 Topic 을 백 번 열어도 생성은 한 번이다.
 *   ③ 예산 — reserve() 가 원자적으로 한 칸을 잡는다. 못 잡으면 호출하지 않는다.
 *
 * (①은 세션 가드, ④는 OpenAI 대시보드의 하드 리밋이다.)
 */

export interface EnsureDeps {
  db: Db
  clock: Clock
  llm: LlmClient
  graph: CurriculumGraph
}

/** 계획 항목에서 필요한 것만. plan_items 행 전체를 받지 않는다. */
export interface MaterialRequest {
  topicId: string
  kind: 'new' | 'review' | 'remediation'
  /** 복습 회차. null 이면 원래 콘텐츠를 다시 쓴다 (취약 재학습) */
  round: number | null
  minutes: number
}

export type EnsureResult =
  | { ok: true; material: StudyMaterial; generated: boolean }
  | { ok: false; code: EnsureFailure; message: string }

export type EnsureFailure =
  /** 예산이 없다. LLM 을 부르지 않았다 */
  | 'BUDGET_EXCEEDED'
  /** 호출했지만 실패했거나 응답이 스키마에 안 맞았다 */
  | 'GENERATION_FAILED'
  /** 저장된 콘텐츠가 지금 스키마로 안 읽힌다. 다시 만들지 않는다 — 사람이 볼 일이다 */
  | 'STORED_INVALID'
  | 'UNKNOWN_TOPIC'

/** 복습 콘텐츠를 새로 만드는가. 취약 재학습(round === null)은 아니다. */
function isReviewRound(req: MaterialRequest): boolean {
  return req.kind === 'review' && req.round !== null
}

const MAX_TOKENS_CONTENT = 3_200
const MAX_TOKENS_REVIEW = 1_900

/**
 * 저장된 자료를 읽는다. 없으면 null, 지금 형식으로 못 읽으면 'invalid'.
 * 화면(서버 컴포넌트)이 직접 쓴다 — 읽기만 하는 경로에는 예산도 호출도 없다.
 */
export async function loadStoredMaterial(
  db: Db, topic: TopicNode, req: MaterialRequest,
): Promise<StudyMaterial | null | 'invalid'> {
  if (isReviewRound(req)) {
    const [row] = await db.select().from(reviewItems)
      .where(and(eq(reviewItems.topicId, topic.id), eq(reviewItems.round, req.round!)))
    if (!row) return null

    // ★ 읽을 때는 저장 스키마다. 생성 스키마로 읽으면 필드를 더할 때마다
    // 그 전에 저장된 자료가 전부 무효가 된다 (실제로 그렇게 깨졌다).
    const parsed = StoredReviewSchema.safeParse(row.content)
    return parsed.success ? materialOfReview(parsed.data, topic.title) : 'invalid'
  }

  const [row] = await db.select().from(topicContents)
    .where(eq(topicContents.topicId, topic.id))
  if (!row) return null

  const parsed = StoredContentSchema.safeParse(row.content)
  return parsed.success ? materialOfContent(parsed.data) : 'invalid'
}

export async function ensureMaterial(
  deps: EnsureDeps,
  req: MaterialRequest,
  progress: Map<string, ProgressState>,
): Promise<EnsureResult> {
  const topic = deps.graph.topics.get(req.topicId)
  if (!topic) {
    return { ok: false, code: 'UNKNOWN_TOPIC', message: `커리큘럼에 없는 주제다: ${req.topicId}` }
  }

  const stored = await loadStoredMaterial(deps.db, topic, req)
  if (stored === 'invalid') {
    return {
      ok: false,
      code: 'STORED_INVALID',
      message: '저장된 자료를 지금 형식으로 읽을 수 없다. 다시 만들지 않는다.',
    }
  }
  // ★ 캐시 히트. 여기서 끝난다 — 예약도 호출도 없다.
  if (stored) return { ok: true, material: stored, generated: false }

  // 취약 재학습인데 원래 콘텐츠가 없다. 그 Topic 은 한 번은 배웠어야 하므로
  // 여기 오면 데이터가 어긋난 것이다. 새로 만들지 않고 알린다.
  if (req.kind === 'review' && req.round === null) {
    return {
      ok: false,
      code: 'STORED_INVALID',
      message: '다시 배울 원래 자료가 없다.',
    }
  }

  const review = isReviewRound(req)
  const ctx = buildTopicContext(deps.graph, topic, {
    mode: req.kind, reviewRound: req.round, minutes: req.minutes, progress,
  })

  // ③ 예산. 못 잡으면 호출하지 않는다.
  const reservation = await reserve(deps.db, deps.clock)
  if (!reservation) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: '오늘 쓸 수 있는 AI 호출을 다 썼다.' }
  }

  const route = review ? 'review' : 'content'

  let result
  try {
    result = await deps.llm.generate<unknown>({
      route,
      system: review ? REVIEW_SYSTEM : contentSystem(topic.kind),
      user: contentUserMessage(ctx),
      schemaName: review ? 'review_content' : 'study_content',
      jsonSchema: review ? REVIEW_JSON_SCHEMA : CONTENT_JSON_SCHEMA,
      maxTokens: review ? MAX_TOKENS_REVIEW : MAX_TOKENS_CONTENT,
      temperature: 0.6,
    })
  } catch {
    // OpenAI 에 닿지 못했거나 HTTP 오류다. 돈이 나가지 않았으므로 예약을 되돌린다.
    await rollback(deps.db, reservation)
    await recordUsage(deps.db, deps.clock, {
      route, subject: topic.subject, model: MODEL,
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    return { ok: false, code: 'GENERATION_FAILED', message: '자료를 만들지 못했다.' }
  }

  /**
   * ★ 검증에 실패해도 예약을 되돌리지 않는다.
   * 응답을 받았다는 건 이미 돈이 나갔다는 뜻이다. 여기서 칸을 돌려주면
   * 검증에 계속 실패하는 응답이 캡에 걸리지 않고 무한히 돈을 태울 수 있다.
   */
  const entry = {
    route, subject: topic.subject, model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
  }

  const stamp = {
    model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
  }

  let material: StudyMaterial

  if (review) {
    const parsed = ReviewSchema.safeParse(result.data)
    if (!parsed.success) {
      await recordUsage(deps.db, deps.clock, { ...entry, ok: false })
      return { ok: false, code: 'GENERATION_FAILED', message: '만들어진 자료가 형식에 맞지 않았다.' }
    }
    // ② 멱등성. 그 사이 다른 요청이 먼저 넣었으면 그쪽 것이 남는다.
    await deps.db.insert(reviewItems)
      .values({ topicId: topic.id, round: req.round!, content: parsed.data })
      .onConflictDoNothing()
    material = materialOfReview(parsed.data, topic.title)
  } else {
    const parsed = ContentSchema.safeParse(result.data)
    if (!parsed.success) {
      await recordUsage(deps.db, deps.clock, { ...entry, ok: false })
      return { ok: false, code: 'GENERATION_FAILED', message: '만들어진 자료가 형식에 맞지 않았다.' }
    }
    await deps.db.insert(topicContents)
      .values({ topicId: topic.id, content: parsed.data, ...stamp })
      .onConflictDoNothing()
    material = materialOfContent(parsed.data)
  }

  await recordUsage(deps.db, deps.clock, { ...entry, ok: true })

  return { ok: true, material, generated: true }
}

/**
 * 계획 항목들 중 자료가 이미 있는 것을 골라낸다.
 *
 * 「오늘의 학습」이 "자료 있음 / 없음"을 정직하게 말하기 위한 것이다.
 * 항목의 status 로 판단하면 안 된다 — 어제 만들어둔 Topic 이 오늘 계획에
 * 다시 뽑히면 새 항목은 pending 이지만 자료는 이미 있다.
 *
 * 반환값의 원소는 `topicId` 또는 `topicId#round` 다.
 */
export function materialKey(topicId: string, kind: string, round: number | null): string {
  return kind === 'review' && round !== null ? `${topicId}#${round}` : topicId
}

export async function loadMaterialKeys(db: Db): Promise<Set<string>> {
  const keys = new Set<string>()
  for (const row of await db.select({ topicId: topicContents.topicId }).from(topicContents)) {
    keys.add(row.topicId)
  }
  for (const row of await db.select({ topicId: reviewItems.topicId, round: reviewItems.round })
    .from(reviewItems)) {
    keys.add(`${row.topicId}#${row.round}`)
  }
  return keys
}
