import type { ModeHarness } from './types'

export const cs: ModeHarness = {
  id: 'cs',
  label: 'CS',
  blurb: '운영체제·자료구조·네트워크·DB. 개념, 비교, 동작 과정, 코드 예시.',
  examples: [
    '프로세스와 스레드를 코드 예시랑 같이 이해하고 싶어.',
    'TCP 3-way handshake 가 왜 필요한지 설명해 줘.',
    'B-트리 인덱스가 왜 디스크에 유리한지 알고 싶어.',
  ],
  activities: [
    { id: 'concept', label: '개념' },
    { id: 'comparison', label: '비교' },
    { id: 'mechanism', label: '동작 과정' },
    { id: 'code', label: '코드 예시' },
  ],
  teaching: `- 설명을 요청하면 직접 설명한다. 모든 질문을 역질문이나 퀴즈로 바꾸지 않는다.
- 비교는 표로, 동작 과정은 순서가 있는 단계로 보여 준다.
- 질문 범위 밖의 구현 세부사항으로 넓히지 않는다.`,
  materialRules: `- 코드 예시는 짧고 실행 가능한 형태로, 언어를 코드 블록에 명시한다.
- 확인 문제는 용어 암기가 아니라 이해를 재는 것으로 낸다 (예: 「이 상황에서 무엇이 일어나는가」).`,
  feedbackRules: `- 용어를 외워 쓴 것과 실제로 이해한 것을 구분한다.
- 오개념이 보이면 무엇이 틀렸고 실제로는 어떻게 동작하는지 짚는다.`,
  claimRules: `- 운영체제·언어·DB 버전에 따라 달라지는 내용은 전제(예: Linux, PostgreSQL 16)를 명시한다.
- 외부 문서를 확인했다고 말하거나 링크를 만들지 않는다.`,
  defaultFeedbackMode: 'full',
  reviewLabel: 'AI 검토',
}
