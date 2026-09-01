import { recordUsage, reserve, rollback } from '../budget/reserve'
import { applyResult, type ApplyResult } from '../mastery/apply'
import {
  completePlanIfDone, recordItemResult, type StoredPlan,
} from '../plan/store'
import { MODEL } from './pricing'
import { GRADE_SYSTEM, gradeUserMessage, type GradeTarget } from './prompts'
import { GRADE_JSON_SCHEMA, GradeSchema, type GradeResult } from './schemas'
import { loadStoredMaterial, type EnsureDeps } from './ensure'

/**
 * 계획 하나를 통째로 채점한다.
 *
 * ★ 항목마다 부르지 않는다. 하루의 채점은 호출 1회다.
 * 항목이 4개면 (생성 4 + 채점 1) = 5회이지, 8회가 아니다. 이 숫자가
 * `lib/plan/build.ts` 의 `estimateCalls` 와 같아야 한다.
 *
 * 채점 온도는 0이다. 같은 답에 다른 판정이 나오면 숙련도가 의미를 잃는다.
 */

export type GradeFailure =
  /** 채점할 답안이 없다. LLM 을 부르지 않았다 */
  | 'NO_ANSWERS'
  /** 예산이 없다. LLM 을 부르지 않았다 */
  | 'BUDGET_EXCEEDED'
  /** 호출했지만 실패했거나 응답이 스키마에 안 맞았다 */
  | 'GRADING_FAILED'
  /** 답안은 있는데 그 자료를 읽을 수 없다 */
  | 'MATERIAL_MISSING'

export interface GradedItem {
  topicId: string
  title: string
  correctPoints: number
  missedPoints: number
  applied: ApplyResult
}

export type GradePlanResult =
  | { ok: true; items: GradedItem[]; planCompleted: boolean }
  | { ok: false; code: GradeFailure; message: string }

/** 채점 응답 한 Topic 분의 포인트를 센다. 숫자는 우리가 만든다. */
function countPoints(graded: GradeResult['topics'][number]): {
  correct: number; missed: number
} {
  return {
    correct: graded.questions.reduce((n, q) => n + q.correct_points.length, 0),
    missed: graded.questions.reduce((n, q) => n + q.missed_points.length, 0),
  }
}

/** 답안이 채워진 항목 수 × 대략적인 응답 길이. 무제한을 두지 않는다. */
function maxTokensFor(count: number): number {
  return 700 * count + 300
}

export async function gradePlan(
  deps: EnsureDeps, plan: StoredPlan,
): Promise<GradePlanResult> {
  const pending = plan.items.filter(
    (i) => i.status === 'studying' && i.answers && Object.keys(i.answers).length > 0,
  )
  if (pending.length === 0) {
    return { ok: false, code: 'NO_ANSWERS', message: '채점할 답안이 없다.' }
  }

  const targets: GradeTarget[] = []
  for (const item of pending) {
    const topic = deps.graph.topics.get(item.topicId)
    if (!topic) continue

    const material = await loadStoredMaterial(deps.db, topic, {
      topicId: item.topicId,
      kind: item.kind as 'new' | 'review' | 'remediation',
      round: item.round,
      minutes: item.minutes,
    })
    if (!material || material === 'invalid') {
      return {
        ok: false,
        code: 'MATERIAL_MISSING',
        message: `${topic.title} 의 자료를 읽을 수 없다.`,
      }
    }

    targets.push({
      topicId: topic.id,
      title: topic.title,
      goal: topic.goal,
      material,
      answers: item.answers!,
    })
  }

  if (targets.length === 0) {
    return { ok: false, code: 'NO_ANSWERS', message: '채점할 답안이 없다.' }
  }

  const reservation = await reserve(deps.db, deps.clock)
  if (!reservation) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: '오늘 쓸 수 있는 AI 호출을 다 썼다.' }
  }

  let result
  try {
    result = await deps.llm.generate<unknown>({
      route: 'grade',
      system: GRADE_SYSTEM,
      user: gradeUserMessage(targets),
      schemaName: 'grade_result',
      jsonSchema: GRADE_JSON_SCHEMA,
      maxTokens: maxTokensFor(targets.length),
      // ★ 0 이다. 채점이 흔들리면 숙련도가 의미를 잃는다.
      temperature: 0,
    })
  } catch {
    await rollback(deps.db, reservation)
    await recordUsage(deps.db, deps.clock, {
      route: 'grade', subject: null, model: MODEL,
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    return { ok: false, code: 'GRADING_FAILED', message: '채점하지 못했다.' }
  }

  const entry = {
    route: 'grade', subject: null, model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
  }

  const parsed = GradeSchema.safeParse(result.data)
  if (!parsed.success) {
    // 돈은 이미 나갔다. 예약을 돌려주지 않는다 (ensure.ts 와 같은 이유).
    await recordUsage(deps.db, deps.clock, { ...entry, ok: false })
    return { ok: false, code: 'GRADING_FAILED', message: '채점 결과가 형식에 맞지 않았다.' }
  }

  await recordUsage(deps.db, deps.clock, { ...entry, ok: true })

  const byTopic = new Map(parsed.data.topics.map((t) => [t.topicId, t]))
  const items: GradedItem[] = []

  for (const target of targets) {
    const graded = byTopic.get(target.topicId)
    // 모델이 한 주제를 빠뜨렸다. 그 항목은 채점되지 않은 채로 남는다 —
    // 없는 점수를 지어내느니 다시 채점받게 두는 편이 낫다.
    if (!graded) continue

    const { correct, missed } = countPoints(graded)
    const applied = await applyResult(deps.db, deps.clock, {
      topicId: target.topicId,
      correctPoints: correct,
      missedPoints: missed,
      weakConcepts: graded.weakConcepts,
    })

    const item = plan.items.find((i) => i.topicId === target.topicId)!
    await recordItemResult(deps.db, plan.id, target.topicId, {
      attemptNo: 1,
      answers: item.answers,
      feedback: graded,
      score: applied.score,
    })

    items.push({
      topicId: target.topicId,
      title: target.title,
      correctPoints: correct,
      missedPoints: missed,
      applied,
    })
  }

  const planCompleted = await completePlanIfDone(deps.db, deps.clock, plan.id)
  return { ok: true, items, planCompleted }
}
