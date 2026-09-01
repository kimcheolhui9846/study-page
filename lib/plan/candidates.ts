import type { CurriculumGraph, TopicNode } from '../curriculum/graph'
import { topicsFor } from '../curriculum/graph'
import { blockingPrerequisites, isUnlocked } from '../mastery/transition'
import { daysOverdue, isDue } from '../mastery/schedule'
import type { PlanCandidate, PlanInput, ProgressState } from './types'

/**
 * 오늘 할 수 있는 것을 모은다. 자르지 않는다 — 자르는 일은 예산이 한다.
 *
 * 설계 §7.1 의 다섯 갈래:
 *   ① 기한이 지난 복습  ② 취약  ③ 선수 부족 보충  ④ 진행 중  ⑤ 신규
 */

const NOT_STARTED = (topicId: string): ProgressState => ({
  topicId, status: 'not_started', masteryScore: 0, wrongCount: 0,
  nextReviewAt: null, reviewRound: 0, lastStudiedAt: null,
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
 * ★ 밀린 복습이 신규를 항상 이긴다. 계수 120 이 그 뜻이다 —
 * 다른 항목이 전부 최대여도 기한 하루 초과를 넘지 못한다.
 */
export function priorityOf(args: {
  overdueDays: number
  wrongCount: number
  blocksCount: number
  inProgress: boolean
  subjectIdleDays: number
  difficulty: number
}): number {
  return (
    120 * Math.min(7, args.overdueDays) +
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
        overdueDays: daysOverdue(st.nextReviewAt, now),
        wrongCount: st.wrongCount,
        blocksCount: 0,
        inProgress: false,
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: `복습 ${st.reviewRound}회차 · ${daysOverdue(st.nextReviewAt, now)}일 밀림`,
    })
  }

  // ② 취약 — 다시 봐야 한다
  for (const topic of included) {
    const st = stateOf(input, topic.id)
    if (st.status !== 'weak') continue

    const blocking = blockingPrerequisites(prereqStates(graph, input, topic))

    // ③ 선수가 부족하면 그 선수를 먼저 — 본인이 아니라 조상을 뽑는다
    if (blocking.length > 0) {
      const worst = blocking.reduce((a, b) => (a.score <= b.score ? a : b))
      push({
        topicId: worst.id,
        subject: worst.node.subject,
        kind: 'remediation',
        round: null,
        minutes: worst.node.estimatedMinutes,
        priority: priorityOf({
          overdueDays: 0,
          wrongCount: stateOf(input, worst.id).wrongCount,
          blocksCount: 1,
          inProgress: true,
          subjectIdleDays: idle(worst.node.subject),
          difficulty: worst.node.difficulty,
        }),
        reason: `${topic.title} 을 열려면 먼저`,
      })
      continue
    }

    // 선수는 멀쩡한데 못 넘었으면 remediation 목록으로
    const fallback = topic.remediation.map((id) => graph.topics.get(id)!).find(Boolean)
    if (fallback) {
      push({
        topicId: fallback.id,
        subject: fallback.subject,
        kind: 'remediation',
        round: null,
        minutes: fallback.estimatedMinutes,
        priority: priorityOf({
          overdueDays: 0, wrongCount: 0, blocksCount: 1, inProgress: true,
          subjectIdleDays: idle(fallback.subject), difficulty: fallback.difficulty,
        }),
        reason: `${topic.title} 의 기초를 보충`,
      })
    }

    // 이 Topic 이 막고 있는 것이 있으면 이유에 담는다.
    // "왜 오늘 이걸 또 하나"의 답이고, 화면이 그대로 보여준다.
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
        overdueDays: 0,
        wrongCount: st.wrongCount,
        blocksCount: blocked.length,
        inProgress: true,
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: blocked.length > 0
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
        overdueDays: 0,
        wrongCount: st.wrongCount,
        blocksCount: 0,
        inProgress: st.status === 'learning',
        subjectIdleDays: idle(topic.subject),
        difficulty: topic.difficulty,
      }),
      reason: st.status === 'learning' ? '이어서' : '새로 배운다',
    })
  }

  return out.sort((a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId))
}
