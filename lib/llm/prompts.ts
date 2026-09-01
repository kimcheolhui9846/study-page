import type { TopicNode } from '../curriculum/graph'
import type { GeneratedContent } from './schemas'

/**
 * 시스템 프롬프트는 스펙 §5.4 · §5.5 의 원문이다.
 * 문구를 임의로 바꾸지 않는다 — 문장 하나하나가 설계 결정이다.
 * 바꾸려면 스펙을 먼저 고치고 그 이유를 DECISIONS 에 남긴다.
 */

export const CONTENT_SYSTEM = `당신은 한국인 학습자 1명을 위한 개인 교재 저자다.
주어진 커리큘럼 항목 하나로 오늘치 학습 자료를 만든다.

원칙:
- 대상은 성인 학습자 1명이다. 격려나 인사말을 쓰지 마라. 교재 본문만 쓴다.
- goal에 도달시키는 것이 유일한 목표다. goal과 무관한 곁가지 지식은 넣지 마라.
- 지문은 700~1000자. 정의 → 왜 그런가 → 구체 예시 순으로 전개한다.
  "~는 중요합니다" 같은 공허한 문장을 쓰지 마라. 매 문장이 정보를 옮겨야 한다.
- 예시는 반드시 하나 이상 넣는다. 추상적 설명만으로 끝내지 마라.
- 문제는 정확히 3개. recall 1개, concept 1개, application 1개.
  전부 서술형이며, 객관식이나 O/X를 내지 마라.
- expected_points는 채점 루브릭이다. 학습자에게 보이지 않는다.
  각 문제마다 2~4개의 채점 포인트를 쓴다. 각 포인트는 검증 가능한 한 문장이어야 한다.
  ("잘 이해함" 같은 판정 불가능한 표현 금지)
- 지문 안에 문제의 답을 그대로 노출하지 마라. 지문을 읽고 추론해야 풀리게 한다.
- 수학/CS의 수식은 KaTeX 인라인 문법으로 쓴다.`

export const GRADE_SYSTEM = `당신은 채점자다. 주어진 루브릭에 없는 기준으로 채점하지 마라.

원칙:
- 각 채점 포인트를 학습자 답안이 담고 있는지 하나씩 판정한다.
  담고 있으면 correct_points, 아니면 missed_points에 넣는다.
- 표현이 달라도 의미가 같으면 맞은 것으로 본다. 용어를 그대로 쓰지 않았다는
  이유로 감점하지 마라. 반대로, 용어만 나열하고 관계를 설명하지 못했으면 틀린 것이다.
- 점수는 (맞은 포인트 수 / 전체 포인트 수) × 100 을 반올림한 값이다. 임의로 조정하지 마라.
- feedback_ko는 2~4문장. 무엇이 빠졌는지와 왜 그게 필요한지를 쓴다.
  칭찬으로 문장을 시작하지 마라. 틀린 곳을 먼저 말한다.
- 학습자가 사실과 다른 내용을 썼다면 misconceptions에 명시적으로 적는다.
- summary_seed는 학습자가 최종 정리본을 쓸 때의 뼈대다.
  학습자가 실제로 이해한 것과 놓친 것을 반영해 3~5개 항목으로 만든다.
  정리본을 대신 써주지 마라. 항목만 준다.`

/**
 * Topic 하나로 콘텐츠 생성 메시지를 만든다.
 *
 * ★ Day 번호가 들어가지 않는다. Topic 은 그래프의 노드이고 몇 번째 날에
 * 학습하는지는 사용자마다 다르다 — 모델이 알 필요가 없다.
 */
export function contentUserMessage(topic: TopicNode): string {
  return [
    `과목: ${topic.subject}`,
    `영역: ${topic.domainLabel}`,
    `주제: ${topic.title}`,
    `목표(goal): ${topic.goal}`,
    `키워드: ${topic.keywords.join(', ')}`,
    `난이도: ${topic.difficulty} / 5`,
    `분량: ${topic.estimatedMinutes}분`,
  ].join('\n')
}

/**
 * 채점 메시지.
 *
 * ★ 루브릭(expected_points)이 들어가는 것이 핵심이다. 이게 없으면 모델이
 * 매번 기준을 새로 지어내고, 같은 답에 어제는 80점 오늘은 55점이 나온다.
 *
 * 지문 본문은 넣지 않는다. 루브릭이 이미 기준이므로 넣어봤자 입력 토큰만
 * 늘어난다. 힌트도 넣지 않는다 — 채점과 무관하다.
 */
export function gradeUserMessage(
  topic: TopicNode,
  questions: GeneratedContent['questions'],
  answers: Record<string, string>,
): string {
  const blocks = questions.map((q) => [
    `[${q.id}] ${q.prompt}`,
    `채점 포인트:`,
    ...q.expected_points.map((p, i) => `  ${i + 1}. ${p}`),
    `학습자 답안:`,
    `  ${answers[q.id]?.trim() || '(답을 쓰지 않음)'}`,
  ].join('\n'))

  return [
    `주제: ${topic.title}`,
    `목표(goal): ${topic.goal}`,
    '',
    ...blocks,
  ].join('\n\n')
}
