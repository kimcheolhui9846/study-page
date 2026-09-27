import { eq } from 'drizzle-orm'
import { topicContents } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import type { CurriculumGraph } from '../curriculum/graph'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import { MODEL } from './pricing'
import { SOLUTION_SYSTEM, solutionUserMessage } from './prompts'
import {
  SOLUTIONS_JSON_SCHEMA, SolutionsSchema, StoredContentSchema, type Solution,
} from './schemas'
import type { LlmClient } from './types'

/**
 * 해설이 없던 시절에 만들어진 자료에 해설만 채워 넣는다.
 *
 * ★ 지문과 문제를 다시 만들지 않는다. 학습자가 이미 그 지문을 읽고 그
 * 문제에 답했다. 새로 만들면 이미 쓴 답과 채점 기록이 가리키는 문제가
 * 달라진다 — 그건 복구가 아니라 덮어쓰기다.
 *
 * ★ 예산 게이트를 그대로 지난다. 스크립트가 부른다고 해서 캡 밖에서
 * 도는 돈 쓰는 경로를 만들지 않는다. 방어선에 뒷문을 내면 그게 방어선이
 * 아니게 된다.
 */

const MAX_TOKENS = 1_600

export interface BackfillDeps {
  db: Db
  clock: Clock
  llm: LlmClient
  graph: CurriculumGraph
}

export type BackfillOutcome =
  | { topicId: string; status: 'filled'; questions: number; costMicros: number }
  | { topicId: string; status: 'skipped'; reason: string }
  | { topicId: string; status: 'failed'; reason: string }

/** 해설이 하나라도 빠진 자료의 Topic id. 이미 다 있는 것은 건드리지 않는다. */
export async function topicsMissingSolutions(db: Db): Promise<string[]> {
  const rows = await db
    .select({ topicId: topicContents.topicId, content: topicContents.content })
    .from(topicContents)

  const out: string[] = []
  for (const row of rows) {
    const parsed = StoredContentSchema.safeParse(row.content)
    // 읽히지 않는 행은 여기서 다루지 않는다 — 그건 사람이 볼 일이다.
    if (!parsed.success) continue
    if (parsed.data.questions.some((q) => q.solution === undefined)) out.push(row.topicId)
  }
  return out.sort()
}

export async function backfillSolutions(
  deps: BackfillDeps, topicId: string,
): Promise<BackfillOutcome> {
  const topic = deps.graph.topics.get(topicId)
  if (!topic) return { topicId, status: 'skipped', reason: '커리큘럼에 없는 주제다' }

  const [row] = await deps.db.select().from(topicContents)
    .where(eq(topicContents.topicId, topicId))
  if (!row) return { topicId, status: 'skipped', reason: '저장된 자료가 없다' }

  const parsed = StoredContentSchema.safeParse(row.content)
  if (!parsed.success) return { topicId, status: 'skipped', reason: '자료를 읽을 수 없다' }

  const missing = parsed.data.questions.filter((q) => q.solution === undefined)
  if (missing.length === 0) {
    return { topicId, status: 'skipped', reason: '이미 해설이 있다' }
  }

  // ③ 예산. 못 잡으면 호출하지 않는다.
  const reservation = await reserve(deps.db, deps.clock)
  if (!reservation) return { topicId, status: 'failed', reason: '오늘 쓸 수 있는 호출을 다 썼다' }

  let result
  try {
    result = await deps.llm.generate<unknown>({
      route: 'solution',
      system: SOLUTION_SYSTEM,
      user: solutionUserMessage({
        title: topic.title,
        goal: topic.goal,
        bodyMd: parsed.data.passage.body_md,
        questions: missing.map((q) => ({
          id: q.id, prompt: q.prompt, expected_points: q.expected_points,
        })),
      }),
      schemaName: 'question_solutions',
      jsonSchema: SOLUTIONS_JSON_SCHEMA,
      maxTokens: MAX_TOKENS,
      temperature: 0.4,
    })
  } catch {
    // 닿지 못했다. 돈이 나가지 않았으므로 예약을 되돌린다.
    await rollback(deps.db, reservation)
    await recordUsage(deps.db, deps.clock, {
      route: 'solution', subject: topic.subject, model: MODEL,
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    return { topicId, status: 'failed', reason: '호출이 실패했다' }
  }

  const entry = {
    route: 'solution', subject: topic.subject, model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
  }

  // 검증에 실패해도 예약을 되돌리지 않는다 — 돈은 이미 나갔다.
  // (`lib/llm/ensure.ts` 와 같은 이유다.)
  const got = SolutionsSchema.safeParse(result.data)
  if (!got.success) {
    await recordUsage(deps.db, deps.clock, { ...entry, ok: false })
    return { topicId, status: 'failed', reason: '해설이 형식에 맞지 않았다' }
  }

  const byId = new Map<string, Solution>(
    got.data.solutions.map((s) => [s.id, {
      answer_md: s.answer_md, steps: s.steps, evidence: s.evidence,
    }]),
  )

  // 모델이 빠뜨린 문제가 있으면 채우지 않는다. 절반만 채워두면 다음에
  // 다시 돌릴 때 무엇이 남았는지 알기 어렵고, 화면은 들쭉날쭉해진다.
  const filled = parsed.data.questions.map((q) => {
    const next = q.solution ?? byId.get(q.id)
    return next ? { ...q, solution: next } : q
  })
  if (filled.some((q) => q.solution === undefined)) {
    await recordUsage(deps.db, deps.clock, { ...entry, ok: false })
    return { topicId, status: 'failed', reason: '해설이 빠진 문제가 있다' }
  }

  await deps.db.update(topicContents)
    .set({ content: { ...parsed.data, questions: filled } })
    .where(eq(topicContents.topicId, topicId))

  await recordUsage(deps.db, deps.clock, { ...entry, ok: true })

  return {
    topicId,
    status: 'filled',
    questions: missing.length,
    costMicros: result.costMicros,
  }
}
