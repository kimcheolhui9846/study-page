/**
 * 환경별 캡.
 *
 * Preview/Local 을 낮게 두는 것이 중요하다. 버셀은 PR마다 Preview 배포를 만들고,
 * 개발 중 useEffect 의존성 실수 같은 루프 버그는 흔하다.
 * 캡이 3이면 그런 사고의 손해가 커피값도 안 된다.
 */
export function dailyCallCap(): number {
  return process.env.APP_ENV === 'production' ? 20 : 3
}

/** 월 비용 상한. USD × 1,000,000. 부동소수를 쓰지 않는다. */
export function monthlyCostCapMicros(): number {
  return process.env.APP_ENV === 'production' ? 3_000_000 : 500_000 // $3.00 / $0.50
}
