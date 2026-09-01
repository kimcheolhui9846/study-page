import type { Subject } from '../curriculum/schema'
import type { MasteryStatus } from '../mastery/transition'

/**
 * 계획 엔진이 보는 세계.
 *
 * ★ DB 도 LLM 도 모른다. 값을 받아 값을 낸다 — 그래서 가상의 30일을
 * 돌려보는 시뮬레이션 테스트가 가능하다.
 */

/** 한 Topic 의 현재 상태. DB 의 topic_progress 를 그대로 옮긴 모양이다. */
export interface ProgressState {
  topicId: string
  status: MasteryStatus
  masteryScore: number
  wrongCount: number
  /** KST 날짜 'YYYY-MM-DD'. null 이면 복습 예정 없음 */
  nextReviewAt: string | null
  reviewRound: number
  /** KST 날짜. null 이면 학습한 적 없음 */
  lastStudiedAt: string | null
}

export type PlanItemKind = 'new' | 'review' | 'remediation'

export interface PlanCandidate {
  topicId: string
  subject: Subject
  kind: PlanItemKind
  minutes: number
  priority: number
  /** 복습이면 회차. 신규·보충은 null */
  round: number | null
  /** 왜 뽑혔는지. 화면이 그대로 보여준다 */
  reason: string
}

export interface DailyPlan {
  dayNumber: number
  studyDate: string
  items: PlanCandidate[]
  estimatedCalls: number
  estimatedMinutes: number
  /** 예산 때문에 잘린 항목. 숨기지 않는다 */
  deferred: PlanCandidate[]
}

export interface PlanInput {
  studyDate: string
  dayNumber: number
  dailyStudyMinutes: number
  targetDayCount: number
  /** topicId → 상태. 없으면 not_started 로 본다 */
  progress: Map<string, ProgressState>
  /** 오늘 남은 LLM 호출 수 */
  callsLeft: number
  subjectPriority?: Partial<Record<Subject, number>>
}
