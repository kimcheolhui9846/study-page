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
 * KST 기준 시각 '08:30'.
 *
 * 원장의 `created_at` 은 UTC 로 저장된다. 화면에서 toLocaleTimeString 을 쓰면
 * 보는 사람의 시간대를 따라가 서버가 판정하는 '오늘'과 어긋난다 —
 * 날짜와 같은 이유로 시각도 여기서만 만든다.
 */
export function kstTimeLabel(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16)
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

/**
 * 날짜 문자열 산술.
 *
 * ★ Date 산술에 시간대가 끼어들지 않게 UTC 정오를 기준점으로 쓴다.
 * KST(+09:00)든 어디든 정오에서 ±12시간 안에는 날짜가 안 바뀐다.
 *
 * 'YYYY-MM-DD' 만 다룬다 — 이 앱에서 날짜는 KST 달력의 하루이지 시각이 아니다.
 */
export function addDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T12:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** from 에서 to 까지 며칠. to 가 앞서면 음수다. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime()
  const b = new Date(`${to}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}
