import { topicsFor, type CurriculumGraph } from '../curriculum/graph'
import { SUBJECTS, type Subject } from '../curriculum/schema'
import { subjectLabel } from '../curriculum/overview'
import type { ProgressState } from '../plan/types'
import { addDays, daysBetween } from '../time'

/**
 * 대시보드가 보여줄 숫자들.
 *
 * ★ DB 도 화면도 모른다. 값을 받아 값을 낸다 — 그래서 전부 테스트된다.
 * 화면은 이 함수들이 낸 것을 그리기만 한다.
 */

// ── 과목별 진도 ──────────────────────────────────

export interface SubjectProgress {
  subject: Subject
  label: string
  total: number
  mastered: number
  /** 배우는 중이거나 복습 중 */
  inProgress: number
  weak: number
  notStarted: number
  totalMinutes: number
  masteredMinutes: number
  /** 0~100. 화면의 막대가 이 값이다 */
  percent: number
}

export function subjectProgress(
  graph: CurriculumGraph,
  targetDayCount: number,
  progress: Map<string, ProgressState>,
): SubjectProgress[] {
  const included = topicsFor(graph, targetDayCount)

  return SUBJECTS.map((subject) => {
    const mine = included.filter((t) => t.subject === subject)

    let mastered = 0
    let inProgress = 0
    let weak = 0
    let masteredMinutes = 0

    for (const t of mine) {
      const status = progress.get(t.id)?.status ?? 'not_started'
      if (status === 'mastered') {
        mastered += 1
        masteredMinutes += t.estimatedMinutes
      } else if (status === 'weak') {
        weak += 1
      } else if (status !== 'not_started') {
        inProgress += 1
      }
    }

    const totalMinutes = mine.reduce((n, t) => n + t.estimatedMinutes, 0)

    return {
      subject,
      label: subjectLabel(graph, subject),
      total: mine.length,
      mastered,
      inProgress,
      weak,
      notStarted: mine.length - mastered - inProgress - weak,
      totalMinutes,
      masteredMinutes,
      // 분이 아니라 Topic 개수로 센다. 분은 추정치이고 개수는 사실이다.
      percent: mine.length === 0 ? 0 : Math.round((mastered / mine.length) * 100),
    }
  })
}

// ── 연속 학습일 ──────────────────────────────────

/**
 * 며칠 연속으로 공부했나.
 *
 * ★ 오늘 아직 안 했다고 연속이 끊기지 않는다. 하루는 아직 안 끝났다 —
 * 어제까지 이어져 있으면 그 수를 보여주고, 오늘 하면 하나 는다.
 * 오늘도 어제도 안 했으면 0 이다.
 */
export function streakDays(studiedDates: Iterable<string>, today: string): number {
  const days = new Set(studiedDates)
  if (days.size === 0) return 0

  // 오늘 했으면 오늘부터, 아니면 어제부터 거슬러 센다.
  let cursor = days.has(today) ? today : addDays(today, -1)
  if (!days.has(cursor)) return 0

  let n = 0
  while (days.has(cursor)) {
    n += 1
    cursor = addDays(cursor, -1)
  }
  return n
}

// ── 예상 완료일 ──────────────────────────────────

/**
 * 실제 속도로 언제 끝나나.
 *
 * ★ 목표 기간에서 역산하지 않는다. 그건 희망이지 예측이 아니다.
 * 실제로 숙달한 Topic 수를 실제로 공부한 날 수로 나눈다.
 */
export interface Pace {
  /** 실제로 무언가 한 날의 수 */
  activeDays: number
  masteredTopics: number
  /** 하루에 몇 개를 숙달했나 */
  perDay: number
  remaining: number
  /** 남은 날 수. 아직 잴 수 없으면 null */
  estimatedDays: number | null
  /** KST 날짜. 아직 잴 수 없으면 null */
  estimatedDate: string | null
}

/**
 * 이 날 수보다 적게 공부했으면 예측하지 않는다.
 *
 * 이틀 하고 "앞으로 400일"이라고 말하는 건 정보가 아니라 소음이다.
 * 표본이 쌓이기 전에는 모른다고 말하는 편이 낫다.
 */
export const MIN_DAYS_TO_ESTIMATE = 3

export function paceOf(args: {
  activeDays: number
  masteredTopics: number
  totalTopics: number
  today: string
}): Pace {
  const remaining = Math.max(0, args.totalTopics - args.masteredTopics)
  const perDay = args.activeDays === 0 ? 0 : args.masteredTopics / args.activeDays

  const measurable = args.activeDays >= MIN_DAYS_TO_ESTIMATE && perDay > 0
  const estimatedDays = measurable ? Math.ceil(remaining / perDay) : null

  return {
    activeDays: args.activeDays,
    masteredTopics: args.masteredTopics,
    perDay,
    remaining,
    estimatedDays,
    estimatedDate: estimatedDays === null ? null : addDays(args.today, estimatedDays),
  }
}

// ── 최근 점수 ───────────────────────────────────

export interface RecentScore {
  topicId: string
  title: string
  subject: Subject
  score: number
  studyDate: string
}

/**
 * 최근 채점 결과. 새 것부터.
 *
 * 커리큘럼에서 사라진 Topic 은 뺀다 — 제목을 붙일 수 없으면 보여줄 것이 없다.
 */
export function recentScores(
  graph: CurriculumGraph,
  graded: Array<{ topicId: string; score: number; studyDate: string }>,
  limit = 6,
): RecentScore[] {
  return graded
    .filter((g) => graph.topics.has(g.topicId))
    .sort((a, b) => b.studyDate.localeCompare(a.studyDate) || a.topicId.localeCompare(b.topicId))
    .slice(0, limit)
    .map((g) => {
      const topic = graph.topics.get(g.topicId)!
      return {
        topicId: g.topicId,
        title: topic.title,
        subject: topic.subject,
        score: g.score,
        studyDate: g.studyDate,
      }
    })
}

// ── 복습 부담 ───────────────────────────────────

/**
 * 앞으로 며칠 안에 복습이 몇 개 밀려 있나.
 *
 * 이 숫자가 커지면 신규 진도가 느려진다 — 화면이 그것을 미리 보여준다.
 */
export function reviewLoad(
  progress: Map<string, ProgressState>, today: string, withinDays = 7,
): { due: number; upcoming: number } {
  let due = 0
  let upcoming = 0

  for (const st of progress.values()) {
    if (!st.nextReviewAt) continue
    const gap = daysBetween(today, st.nextReviewAt)
    if (gap <= 0) due += 1
    else if (gap <= withinDays) upcoming += 1
  }
  return { due, upcoming }
}
