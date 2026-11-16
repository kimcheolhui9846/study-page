/**
 * 과목 모드.
 *
 * ★ 커리큘럼 경로의 `mode`(new·review·remediation, 오늘 이걸 왜 하나)나
 * `TopicKind`(Topic 의 성격)와 **다른 축**이다. 이름이 겹치지 않게 `StudyMode` 라 부른다.
 */
export const STUDY_MODES = ['english', 'math', 'cs', 'coding'] as const
export type StudyMode = (typeof STUDY_MODES)[number]

/** 제출 피드백의 깊이. 「오류만」은 고친 답·정답 코드를 내지 않는다 */
export type FeedbackMode = 'full' | 'errors-only'

export interface Activity {
  id: string
  label: string
}

/**
 * 모드 하나의 하네스. 역할 문장만 바꾸는 설정이 아니다 —
 * 지도 방식·활동·자료 형식·피드백 기준·공개 정책·주장 금지를 함께 정한다.
 *
 * 전부 데이터다. 공통 엔진(lib/study/engine.ts)이 이 값을 프롬프트로 옮긴다.
 */
export interface ModeHarness {
  id: StudyMode
  label: string
  /** 홈 카드의 한 줄 */
  blurb: string
  /** 입력 예시. 홈에서 누르면 입력칸에 들어간다 */
  examples: string[]
  activities: Activity[]
  /** 어떻게 가르치는가 */
  teaching: string
  /** 자료·문제를 어떤 모양으로 만드는가 */
  materialRules: string
  /** 제출을 어떻게 보는가 */
  feedbackRules: string
  /** 하지 않은 일을 했다고 말하지 않기 */
  claimRules: string
  defaultFeedbackMode: FeedbackMode
  /** 피드백 화면의 판정 라벨. 실행·채점기가 아니라는 것을 숨기지 않는다 */
  reviewLabel: string
}
