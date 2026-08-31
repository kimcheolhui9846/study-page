const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * KST 기준 오늘 날짜 'YYYY-MM-DD'.
 *
 * 버셀 서버는 UTC로 돈다. CURRENT_DATE 나 new Date().getDate() 를 쓰면
 * 한국 시간 오전 9시 이전에 날짜가 하루 밀린다 — 새벽에 공부하는 사람에게 치명적이다.
 * 날짜 계산은 전부 이 함수 하나로 좁힌다.
 */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** KST 기준 이번 달 'YYYY-MM'. 월간 예산 카운터의 키가 된다. */
export function kstMonth(now: Date): string {
  return kstToday(now).slice(0, 7)
}

/**
 * 시간을 주입 가능하게 만드는 지점.
 * 세션 만료(15분/2시간)와 예산 캡(일/월) 테스트에서 sleep 을 없애기 위해 존재한다.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
