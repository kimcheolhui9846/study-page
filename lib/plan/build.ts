import type { CurriculumGraph } from '../curriculum/graph'
import { SUBJECTS, type Subject } from '../curriculum/schema'
import { collectCandidates } from './candidates'
import type { DailyPlan, PlanCandidate, PlanInput } from './types'

/**
 * 하루 계획을 만든다. **LLM 을 한 번도 부르지 않는다.**
 *
 * 순서: 후보 모으기 → 시간 배분 → 예산에 맞춰 자르기
 */

const DEFAULT_RATIO: Record<Subject, number> = { english: 0.3, math: 0.3, cs: 0.4 }

/**
 * 과목별 시간 비율.
 *
 * 기본값에서 출발해 보정한다:
 *   - 숙련도가 낮은 과목에 가중
 *   - 오래 안 한 과목에 가중
 * 그리고 합이 1 이 되게 정규화한다.
 */
export function subjectRatios(
  graph: CurriculumGraph, input: PlanInput,
): Record<Subject, number> {
  const raw: Record<string, number> = {}

  for (const s of SUBJECTS) {
    let r = input.subjectPriority?.[s] ?? DEFAULT_RATIO[s]

    const mine = [...input.progress.values()].filter(
      (p) => graph.topics.get(p.topicId)?.subject === s,
    )
    const avg = mine.length === 0
      ? 0
      : mine.reduce((n, p) => n + p.masteryScore, 0) / mine.length

    // 학습을 시작했는데 평균이 낮으면 시간을 더 준다
    if (mine.length > 0 && avg < 60) r += 0.1
    // 복습이 밀려 있으면 더 준다
    if (mine.filter((p) => p.nextReviewAt !== null).length >= 5) r += 0.1

    raw[s] = r
  }

  const total = SUBJECTS.reduce((n, s) => n + raw[s], 0)
  return Object.fromEntries(
    SUBJECTS.map((s) => [s, raw[s] / total]),
  ) as Record<Subject, number>
}

/**
 * 시간 안에 들어가는 만큼만 고른다.
 *
 * 과목별 한도를 두되, 한 과목이 남긴 시간은 버리지 않고 다른 과목이 쓴다 —
 * 영어가 오늘 할 게 없다고 하루가 짧아질 이유는 없다.
 */
function fitToTime(
  candidates: PlanCandidate[], totalMinutes: number, ratios: Record<Subject, number>,
): { chosen: PlanCandidate[]; deferred: PlanCandidate[] } {
  const budget: Record<string, number> = {}
  for (const s of SUBJECTS) budget[s] = totalMinutes * ratios[s]

  const chosen: PlanCandidate[] = []
  const overflow: PlanCandidate[] = []
  let usedTotal = 0

  // 1차 — 과목별 한도를 지킨다. 한 과목이 하루를 다 먹지 않게.
  for (const c of candidates) {
    if (c.minutes <= budget[c.subject] && usedTotal + c.minutes <= totalMinutes) {
      budget[c.subject] -= c.minutes
      usedTotal += c.minutes
      chosen.push(c)
    } else {
      overflow.push(c)
    }
  }

  // 2차 — 남은 시간을 버리지 않는다. 영어가 오늘 할 게 없다고
  // 하루가 짧아질 이유는 없다. 우선순위 순서는 그대로다.
  const deferred: PlanCandidate[] = []
  for (const c of overflow) {
    if (usedTotal + c.minutes <= totalMinutes) {
      usedTotal += c.minutes
      chosen.push(c)
    } else {
      deferred.push(c)
    }
  }

  // 우선순위 순서를 되돌린다 — 2차에서 뒤에 붙은 것들이 섞였다
  chosen.sort((a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId))
  return { chosen, deferred }
}

/**
 * 오늘 필요한 LLM 호출 수.
 *
 * ★ 채점을 계획 단위로 묶는다. Topic 마다 채점하면 하루 5호출이지만
 * 하루치 답안을 한 번에 채점하면 1호출이다. 루브릭이 Topic 마다 있으므로
 * 프롬프트에 함께 실으면 된다.
 */
export function needsGeneration(item: PlanCandidate): boolean {
  // 취약한 Topic 을 다시 배우는 경우(round === null)는 원래 지문을 다시 읽는다.
  // 새로 만들 것이 없으므로 호출도 없다.
  return !(item.kind === 'review' && item.round === null)
}

export function estimateCalls(items: PlanCandidate[]): number {
  if (items.length === 0) return 0
  return items.filter(needsGeneration).length + 1 // + 채점 1회
}

/**
 * 예산에 맞춰 자른다.
 *
 * ★ 캡을 올리지 않는다. 계획을 줄인다.
 * 밀려난 항목은 내일 우선순위가 올라 자연히 앞으로 온다.
 */
function fitToBudget(
  items: PlanCandidate[], callsLeft: number,
): { chosen: PlanCandidate[]; deferred: PlanCandidate[] } {
  // 채점 1회를 빼고 남는 것이 콘텐츠에 쓸 수 있는 호출 수다.
  const contentBudget = Math.max(0, callsLeft - 1)

  const chosen: PlanCandidate[] = []
  const deferred: PlanCandidate[] = []
  let used = 0

  // items 는 우선순위 높은 순이다. 생성이 필요 없는 항목은 예산을 쓰지 않으므로
  // 예산이 바닥나도 계속 담는다 — 공짜인 것을 미룰 이유가 없다.
  for (const c of items) {
    if (!needsGeneration(c)) { chosen.push(c); continue }
    if (used < contentBudget) { used += 1; chosen.push(c) }
    else deferred.push(c)
  }

  // 담긴 것이 전부 공짜면 채점 1회조차 필요 없다 — 그건 estimateCalls 가 센다.
  return { chosen, deferred }
}

export function buildDailyPlan(
  graph: CurriculumGraph, input: PlanInput, now: Date,
): DailyPlan {
  const candidates = collectCandidates(graph, input, now)
  const ratios = subjectRatios(graph, input)

  const byTime = fitToTime(candidates, input.dailyStudyMinutes, ratios)
  const byBudget = fitToBudget(byTime.chosen, input.callsLeft)

  const items = byBudget.chosen

  return {
    dayNumber: input.dayNumber,
    studyDate: input.studyDate,
    items,
    estimatedCalls: estimateCalls(items),
    estimatedMinutes: items.reduce((n, c) => n + c.minutes, 0),
    // 시간에서 밀린 것과 예산에서 밀린 것을 함께 보여준다. 숨기지 않는다.
    deferred: [...byBudget.deferred, ...byTime.deferred],
  }
}
