/**
 * 환경별 캡.
 *
 * Preview/Local 을 낮게 두는 것이 중요하다. 버셀은 PR마다 Preview 배포를 만들고,
 * 개발 중 useEffect 의존성 실수 같은 루프 버그는 흔하다.
 *
 * 2026-11-16 — 자유학습 전환으로 올렸다 (사용자 결정, docs/DECISIONS.md).
 * 자유 채팅은 질문·피드백마다 호출이 나가므로 하루 20회면 세션 하나로 끝난다.
 *   운영: 하루 20 → 100회, 월 $3 → $20
 *   그 외: 하루 3 → 10회 (흐름 한 바퀴를 손으로 확인할 수 있게), 월 $0.50 그대로
 * 월 비용 캡이 진짜 상한이다 — 하루 캡은 루프 사고의 폭을 줄인다.
 */
export function dailyCallCap(): number {
  return process.env.APP_ENV === 'production' ? 100 : 10
}

/** 월 비용 상한. USD × 1,000,000. 부동소수를 쓰지 않는다. */
export function monthlyCostCapMicros(): number {
  return process.env.APP_ENV === 'production' ? 20_000_000 : 500_000 // $20.00 / $0.50
}
