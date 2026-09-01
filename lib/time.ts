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

const KST_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 화면 상단에 찍는 KST 날짜 '2026 · 09 · 01  월'.
 *
 * 클라이언트에서 new Date() 로 만들면 사용자의 로컬 시간대를 따라가 서버가
 * 판정하는 '오늘'과 어긋난다. 그래서 이 라벨은 서버 컴포넌트에서만 만든다.
 */
export function kstDateLabel(now: Date): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  const [y, m, d] = kstToday(now).split('-')
  return `${y} · ${m} · ${d}  ${KST_WEEKDAYS[shifted.getUTCDay()]}`
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
