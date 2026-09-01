import { SUBJECTS, type Subject } from './schema'
import { topicsFor, type CurriculumGraph, type TopicNode } from './graph'

/**
 * 커리큘럼을 화면이 쓰기 좋은 모양으로 접는다.
 *
 * ★ 여기에 학습 결과가 들어가지 않는다. 2단계에서 topic_progress 가 생기면
 * 그때 진도를 얹는다. 지금은 "커리큘럼이 무엇을 담고 있나"만 말한다.
 */

export interface SubjectOverview {
  subject: Subject
  label: string
  topicCount: number
  totalMinutes: number
  domains: DomainOverview[]
}

export interface DomainOverview {
  domain: string
  label: string
  order: number
  topics: TopicNode[]
  totalMinutes: number
}

export function subjectLabel(graph: CurriculumGraph, subject: Subject): string {
  // 과목 라벨은 따로 두지 않는다. 도메인 파일의 subject 로 충분히 식별되고,
  // 화면에 쓰는 이름은 여기 한 곳에서만 정한다.
  const KO: Record<Subject, string> = { english: '영어', math: '수학', cs: '컴퓨터 과학' }
  void graph
  return KO[subject]
}

export function overview(graph: CurriculumGraph, targetDayCount: number): SubjectOverview[] {
  const included = topicsFor(graph, targetDayCount)

  return SUBJECTS.map((subject) => {
    const mine = included.filter((t) => t.subject === subject)

    const byDomain = new Map<string, DomainOverview>()
    for (const t of mine) {
      let d = byDomain.get(t.domain)
      if (!d) {
        d = { domain: t.domain, label: t.domainLabel, order: t.domainOrder, topics: [], totalMinutes: 0 }
        byDomain.set(t.domain, d)
      }
      d.topics.push(t)
      d.totalMinutes += t.estimatedMinutes
    }

    return {
      subject,
      label: subjectLabel(graph, subject),
      topicCount: mine.length,
      totalMinutes: mine.reduce((n, t) => n + t.estimatedMinutes, 0),
      domains: [...byDomain.values()].sort((a, b) => a.order - b.order),
    }
  })
}

/**
 * 목표 기간이 실제로 가능한지 본다.
 *
 * 커리큘럼이 담은 총 시간을 하루 학습 시간으로 나눈 것이 필요한 날 수다.
 * 목표보다 크면 그 기간에 다 못 끝낸다 — 화면이 그것을 숨기지 않는다.
 */
export interface Feasibility {
  totalMinutes: number
  requiredDays: number
  targetDayCount: number
  fits: boolean
}

export function feasibility(
  graph: CurriculumGraph, targetDayCount: number, dailyMinutes: number,
): Feasibility {
  const totalMinutes = topicsFor(graph, targetDayCount)
    .reduce((n, t) => n + t.estimatedMinutes, 0)
  const requiredDays = Math.ceil(totalMinutes / Math.max(1, dailyMinutes))

  return { totalMinutes, requiredDays, targetDayCount, fits: requiredDays <= targetDayCount }
}
