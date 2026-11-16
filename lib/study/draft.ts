/**
 * 답안 초안을 브라우저에 남긴다.
 *
 * 세션이 닫혀도 쓰던 답을 잃지 않게 하는 것이 목적이다. 세션 바의 만료
 * 경고가 "쓰던 답은 브라우저에 남는다"고 말하는 근거가 이 파일이다.
 * 이게 없으면 그 문장은 거짓말이다.
 *
 * localStorage 접근 자체가 던지는 환경이 있다(사생활 보호 모드, 사이트
 * 데이터 차단). 초안은 편의 기능이므로 실패해도 화면이 죽으면 안 된다 —
 * 전부 삼키고 빈 값을 준다.
 */
export type Answers = Record<string, string>

export function draftKey(topicId: string): string {
  return `study-page:draft:${topicId}`
}

export function loadDraft(topicId: string): Answers {
  try {
    const raw = localStorage.getItem(draftKey(topicId))
    if (!raw) return {}

    const parsed: unknown = JSON.parse(raw)
    // 배열과 null 도 typeof 'object' 다. 순수 객체만 받는다.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Answers
  } catch {
    return {}
  }
}

export function saveDraft(topicId: string, answers: Answers): void {
  try {
    localStorage.setItem(draftKey(topicId), JSON.stringify(answers))
  } catch {
    // 저장 못 해도 화면은 계속 돈다
  }
}

export function clearDraft(topicId: string): void {
  try {
    localStorage.removeItem(draftKey(topicId))
  } catch {
    // 무시
  }
}

// ── 자유학습 ─────────────────────────────────────
//
// 답안·코드·채팅 입력을 칸마다 문자열로 남긴다. 실패·인증 만료·새로고침에도
// 쓰던 것을 잃지 않게 하는 것이 목적이다. 위 함수들과 같은 이유로 전부 삼킨다.

export function studyDraftKey(scope: string): string {
  return `study-page:study:${scope}`
}

export function loadText(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function saveText(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // 저장 못 해도 화면은 계속 돈다
  }
}
