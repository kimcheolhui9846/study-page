import type { Clock } from '../../lib/time'

/**
 * 테스트용 시계. advance 로 시간을 임의로 민다.
 * 호출할 때마다 새 Date 를 주므로 호출자가 변형해도 시계가 망가지지 않는다.
 */
export function fixedClock(iso: string): Clock & { advance(ms: number): void } {
  let t = new Date(iso).getTime()
  return {
    now: () => new Date(t),
    advance: (ms: number) => { t += ms },
  }
}
