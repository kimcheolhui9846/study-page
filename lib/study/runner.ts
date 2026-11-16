/**
 * 코드 실행기 경계.
 *
 * 지금은 없다. 코테 피드백은 코드를 **읽고** 내리는 AI 코드 검토이며,
 * 화면과 프롬프트가 그렇게 말한다 (lib/study/modes/coding.ts).
 *
 * ★ 일반 서버 프로세스에서 사용자 코드를 실행하지 않는다. 실행기를 붙인다면
 * 격리된 샌드박스(별도 서비스)로 하고, 이 인터페이스를 넓혀 결과를 받는다.
 */
export interface CodeRunner {
  readonly available: false
}

export const NO_RUNNER: CodeRunner = { available: false }
