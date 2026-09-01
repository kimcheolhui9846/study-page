import type { CurriculumGraph, TopicNode } from '../curriculum/graph'
import { topicsFor } from '../curriculum/graph'
import { isUnlocked } from '../mastery/transition'
import { daysOverdue, isDue } from '../mastery/schedule'
import { recoveryPhaseOf, type RecoveryTarget } from '../mastery/recovery'
import type { PlanCandidate, PlanInput, ProgressState } from './types'

/**
 * 오늘 할 수 있는 것을 모은다. 자르지 않는다 — 자르는 일은 예산이 한다.
 *
 * 설계 §7.1 의 다섯 갈래:
 *   ① 기한이 지난 복습  ② 취약  ③ 선수 부족 보충  ④ 진행 중  ⑤ 신규
 */

const NOT_STARTED = (topicId: string): ProgressState => ({
  topicId, status: 'not_started', masteryScore: 0, attemptCount: 0, wrongCount: 0,
  nextReviewAt: null, reviewRound: 0, lastStudiedAt: null, weakConcepts: [],
})

export function stateOf(input: PlanInput, topicId: string): ProgressState {
  return input.progress.get(topicId) ?? NOT_STARTED(topicId)
}

/** 이 Topic 의 선수들이 각자의 기준을 넘었는가. */
function prereqStates(graph: CurriculumGraph, input: PlanInput, topic: TopicNode) {
  return topic.prerequisites.map((id) => {
    const pre = graph.topics.get(id)!
    return { id, score: stateOf(input, id).masteryScore, passThreshold: pre.passThreshold, node: pre }
  })
}

/**
 * 내려갈 하위 개념. 선수와 보충 Topic 을 합친다.
 *
 * 선수는 "이걸 모르면 못 연다"이고 보충은 "이게 흔들려서 못 넘었다"이다.
 * 회복 단계에서는 둘 다 내려갈 곳이므로 같이 본다.
 */
function recoveryTargets(
  graph: CurriculumGraph, input: PlanInput, topic: TopicNode,
): RecoveryTarget[] {
  const seen = new Set<string>()
  const out: RecoveryTarget[] = []

  for (const id of [...topic.prerequisites, ...topic.remediation]) {
    if (seen.has(id)) continue
    const node = graph.topics.get(id)
    if (!node) continue
    seen.add(id)
    out.push({ id, score: stateOf(input, id).masteryScore, passThreshold: node.passThreshold })
  }
  return out
}

/** 이 Topic 을 마지막으로 공부한 지 며칠. 한 번도 안 했으면 null */
function daysSinceStudied(input: PlanInput, st: ProgressState): number | null {
  if (!st.lastStudiedAt) return null
  const a = new Date(`${input.studyDate}T12:00:00Z`).getTime()
  const b = new Date(`${st.lastStudiedAt}T12:00:00Z`).getTime()
  return Math.max(0, Math.round((a - b) / 86_400_000))
}

/**
 * 며칠째 이 과목을 안 했나. 최대 7로 자른다 —
 * 30일 방치와 8일 방치를 다르게 대우해도 얻는 게 없다.
 */
function daysSinceSubject(input: PlanInput, graph: CurriculumGraph, subject: string): number {
  let latest: string | null = null
  for (const s of input.progress.values()) {
    if (graph.topics.get(s.topicId)?.subject !== subject) continue
    if (s.lastStudiedAt && (latest === null || s.lastStudiedAt > latest)) latest = s.lastStudiedAt
  }
  if (latest === null) return 7 // 한 번도 안 했으면 최대치로 본다

  const a = new Date(`${input.studyDate}T12:00:00Z`).getTime()
  const b = new Date(`${latest}T12:00:00Z`).getTime()
  return Math.min(7, Math.max(0, Math.round((a - b) / 86_400_000)))
}

/**
 * 우선순위 점수. 설계 §7.2 를 그대로 옮겼다.
 *
 * ★ 기한이 된 복습이 신규를 항상 이긴다. 계수 120 이 그 뜻이다 —
 * 다른 항목이 전부 최대여도 기한 하루치를 넘지 못한다.
 *
 * ★ dueDays 는 "며칠째 기한인가"이지 "며칠 밀렸나"가 아니다.
 * 오늘이 기한이면 1이다. 0으로 두면 간격 [1,3,7,14] 의 1회차 복습이
 * 예약된 바로 그날 신규 Topic 에 밀리고, 밀린 다음에야 120점을 받는다 —
 * 간격 반복이 하루씩 늦게 도는 셈이라 예약이 의미를 잃는다.
 */
export function priorityOf(args: {
  /** 기한이 된 지 며칠인가. 오늘이 기한이면 1, 기한이 아니면 0 */
  dueDays: number
  wrongCount: number
  blocksCount: number
  inProgress: boolean
  subjectIdleDays: number
  difficulty: number
}): number {
  return (
    120 * Math.min(7, args.dueDays) +
    80 * Math.min(5, args.wrongCount) +
    60 * (args.blocksCount > 0 ? 1 : 0) +
    40 * (args.inProgress ? 1 : 0) +
    30 * Math.min(7, args.subjectIdleDays) +
    10 * (6 - args.difficulty)
  )
}

export function collectCandidates(
  graph: CurriculumGraph, input: PlanInput, now: Date,
): PlanCandidate[] {
  const included = topicsFor(graph, input.targetDayCount)
  const idleCache = new Map<string, number>()
  const idle = (s: string) => {
    if (!idleCache.has(s)) idleCache.set(s, daysSinceSubject(input, graph, s))
    return idleCache.get(s)!
  }

  // 회복 단계는 한 번만 계산한다. 부모의 보충 대상을 볼 때 다시 필요하다.
  const recoveryCache = new Map<string, ReturnType<typeof recoveryPhaseOf>>()
  const recoveryOf = (topic: TopicNode) => {
    let r = recoveryCache.get(topic.id)
    if (!r) {
      const st = stateOf(input, topic.id)
      r = recoveryPhaseOf({
        attemptCount: st.attemptCount,
        targets: recoveryTargets(graph, input, topic),
        daysSinceStudied: daysSinceStudied(input, st),
      })
      recoveryCache.set(topic.id, r)
    }
    return r
  }

  /**
   * 이 하위 개념을 오늘 할 수 있는가.
   *
   * ★ 접어둔 Topic 은 부모의 보충으로도 끌어내지 않는다. 이걸 안 막으면
   * 접어두기가 뒷문으로 무력화된다 — 부모는 계속 취약이므로 같은 하위를
   * 매일 다시 요구한다.
   */
  const canStudy = (node: TopicNode) =>
    stateOf(input, node.id).status !== 'weak' || recoveryOf(node).phase !== 'parked'

  const out: PlanCandidate[] = []
  const taken = new Set<string>()

  const push = (c: PlanCandidate) => {
    // 한 Topic 은 하루에 한 번만. 복습이자 보충인 경우 먼저 뽑힌 쪽이 이긴다.
    if (taken.has(c.topicId)) return
    taken.add(c.topicId)
    out.push(c)
  }

  // ① 기한이 지난 복습 — 가장 급하다
  for (const topic of included) {
    const st = stateOf(input, topic.id)
    if (!isDue(st.nextReviewAt, now)) continue
    // ★ 취약한 Topic 은 ② 가 다룬다.
    // 여기가 먼저 돌고 push 가 topicId 로 중복을 막기 때문에, 걸러내지 않으면
    // 취약 Topic 이 "복습 N회차"로 잡혀 콘텐츠 생성 비용이 붙는다.
    // 취약은 원래 지문을 다시 읽는 것이고 생성이 0회여야 한다.
    if (st.status === 'weak') continue

    push({
      topicId: topic.id,
      subject: topic.subject,
      kind: 'review',
      // ★ +1 을 하지 않는다. reviewRound 는 "다음에 할 회차"를 담는다 —
      // scheduleNext 가 그렇게 저장한다. 여기서 또 더하면 3회차를 마친 Topic 이
      // 5회차를 요구하게 되고 상한을 넘는다.
      round: st.reviewRound,
      minutes: Math.round(topic.estimatedMinutes * 0.5), // 복습은 신규의 절반
      priority: priorityOf({
        // 오늘이 기한이면 1. 하루 밀렸으면 2. isDue 를 통과했으므로 최소 1이다.
        dueDays: daysOverdue(st.nextReviewAt, now) + 1,
        wrongCount: st.wrongCount,
        blocksCount: 0,
        inProgress: false,
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: `복습 ${st.reviewRound}회차 · ${daysOverdue(st.nextReviewAt, now)}일 밀림`,
    })
  }

  // ② 취약 — 회복 단계에 따라 다르게 다룬다 (설계 §8.3, 사용자 정책 2026-09-02)
  for (const topic of included) {
    const st = stateOf(input, topic.id)
    if (st.status !== 'weak') continue

    const recovery = recoveryOf(topic)

    // ★ 접어둔 Topic 은 오늘 일정에 넣지 않는다.
    // 이것이 "계속 틀리는 Topic 이 일정을 독점한다"를 끊는 지점이다.
    if (recovery.phase === 'parked') continue

    // ③ 하위 개념으로 내려간다. **이 Topic 은 오늘 하지 않는다** —
    // 기초가 흔들리는 채로 같은 문제를 또 푸는 것은 시간 낭비다.
    if (recovery.phase === 'remediation') {
      // 점수가 낮은 것부터, 오늘 할 수 있는 첫 번째 하위 개념.
      const node = recovery.blocking
        .map((t) => graph.topics.get(t.id))
        .find((n): n is TopicNode => n !== undefined && canStudy(n))

      // 내려갈 곳이 전부 접혀 있다. 이 Topic 도 오늘은 넘긴다.
      if (!node) continue

      push({
        topicId: node.id,
        subject: node.subject,
        kind: 'remediation',
        round: null,
        minutes: node.estimatedMinutes,
        priority: priorityOf({
          dueDays: 0,
          wrongCount: stateOf(input, node.id).wrongCount,
          blocksCount: 1,
          inProgress: true,
          subjectIdleDays: idle(node.subject),
          difficulty: node.difficulty,
        }),
        reason: `${topic.title} 의 기초를 보충`,
      })
      continue
    }

    // retry | final-retry — 본인을 다시 본다.
    // 이 Topic 이 막고 있는 것이 있으면 이유에 담는다. "왜 오늘 이걸 또 하나"의
    // 답이고, 화면이 그대로 보여준다.
    const blocked = graph.dependents.get(topic.id) ?? []
    push({
      topicId: topic.id,
      subject: topic.subject,
      kind: 'review',
      // ★ round 가 null 이다. 취약한 Topic 은 "복습"이 아니라 "다시 배우기"다.
      // 간격 반복의 회차를 이어붙이면 4회차를 마친 Topic 이 무너졌을 때
      // 5회차를 요구하게 되고, 그건 상한을 넘는다.
      // 원래 지문을 다시 읽는 것이 맞고 — 그러면 콘텐츠 생성이 필요 없다.
      round: null,
      minutes: topic.estimatedMinutes,
      priority: priorityOf({
        dueDays: 0,
        wrongCount: st.wrongCount,
        blocksCount: blocked.length,
        inProgress: true,
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: recovery.phase === 'final-retry'
        ? '기초를 보충했다 · 마지막으로 다시'
        : blocked.length > 0
          ? `이해가 부족했다 · ${blocked.length}개를 막고 있다`
          : '이해가 부족했다',
    })
  }

  // ④⑤ 진행 중 · 신규 — 선수를 넘긴 것만
  for (const topic of included) {
    const st = stateOf(input, topic.id)
    if (st.status === 'weak' || st.status === 'mastered') continue
    if (st.status === 'reviewing' && !isDue(st.nextReviewAt, now)) continue
    if (!isUnlocked(prereqStates(graph, input, topic))) continue

    push({
      topicId: topic.id,
      subject: topic.subject,
      kind: 'new',
      round: null,
      minutes: topic.estimatedMinutes,
      priority: priorityOf({
        dueDays: 0,
        wrongCount: st.wrongCount,
        blocksCount: 0,
        inProgress: st.status === 'learning',
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: st.status === 'learning' ? '이어서' : '새로 배운다',
    })
  }

  /**
   * ★ 마지막 안전망 — 오늘 할 것이 하나도 없으면 접어둔 것을 되살린다.
   *
   * 접어두기의 취지는 "**다음 진도가 있을 때** 비켜준다"이지 할 일을 없애는
   * 것이 아니다. 전부 못 넘겨 새 Topic 이 하나도 안 열린 학습자에게 빈 하루를
   * 주면, 그건 앱이 포기한 것이다.
   *
   * 가장 오래 안 본 것부터 하나만 되살린다. 재학습이라 생성이 0회다.
   */
  if (out.length === 0) {
    const revived = included
      .filter((t) => stateOf(input, t.id).status === 'weak')
      .sort((a, b) => {
        const sa = stateOf(input, a.id).lastStudiedAt ?? ''
        const sb = stateOf(input, b.id).lastStudiedAt ?? ''
        return sa.localeCompare(sb) || a.id.localeCompare(b.id)
      })[0]

    if (revived) {
      push({
        topicId: revived.id,
        subject: revived.subject,
        kind: 'review',
        round: null,
        minutes: revived.estimatedMinutes,
        priority: 0,
        reason: '오늘 새로 열린 것이 없다 · 다시 본다',
      })
    }
  }

  return out.sort((a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId))
}
