import { describe, it, expect } from 'vitest'
import {
  CRITICAL_MS, WARN_MS,
  earlierDeadline, format, isExpired, stageOf,
} from '../../lib/session/countdown'

describe('stageOf', () => {
  it('15분 남았으면 normal', () => {
    expect(stageOf(15 * 60 * 1000)).toBe('normal')
  })

  it('2분 이하면 warn', () => {
    expect(stageOf(WARN_MS)).toBe('warn')
    expect(stageOf(WARN_MS - 1)).toBe('warn')
    expect(stageOf(WARN_MS + 1)).toBe('normal')
  })

  it('30초 이하면 critical', () => {
    expect(stageOf(CRITICAL_MS)).toBe('critical')
    expect(stageOf(CRITICAL_MS + 1)).toBe('warn')
  })

  it('0 이하면 expired', () => {
    expect(stageOf(0)).toBe('expired')
    expect(stageOf(-1000)).toBe('expired')
  })
})

describe('format', () => {
  it('분:초 로 그린다', () => {
    expect(format(15 * 60 * 1000)).toBe('15:00')
    expect(format(90 * 1000)).toBe('1:30')
    expect(format(5 * 1000)).toBe('0:05')
  })

  it('음수는 0:00 이다 — 마이너스를 보여주지 않는다', () => {
    expect(format(-5000)).toBe('0:00')
  })

  it('올림한다 — 14:59.5 를 14:59 로 보여주고 남은 1초를 삼키지 않는다', () => {
    expect(format(59_500)).toBe('1:00')
  })
})

describe('isExpired', () => {
  /**
   * ★ 이 테스트가 실제 사고에서 나왔다.
   *
   * 예전 코드는 화면에 그려진 남은 시간(state)으로 만료를 판정했다.
   * 서버 응답이 도착한 그 렌더에서 그 값은 아직 초기값 0 이라서,
   * 방금 받아온 15분짜리 세션이 "만료됨"으로 판정됐다.
   * / → /login → / 무한 루프가 됐고 카운트다운이 매번 리셋됐다.
   */
  it('방금 받아온 15분짜리 세션은 만료가 아니다', () => {
    const now = Date.parse('2026-09-01T10:00:00Z')
    expect(isExpired(now + 15 * 60 * 1000, now)).toBe(false)
  })

  it('deadline 을 아직 모르면 만료가 아니다 — 모르는 것과 끝난 것은 다르다', () => {
    expect(isExpired(null, Date.now())).toBe(false)
  })

  it('시각을 지났으면 만료다', () => {
    const now = Date.parse('2026-09-01T10:00:00Z')
    expect(isExpired(now - 1, now)).toBe(true)
    expect(isExpired(now, now)).toBe(true)
  })
})

describe('earlierDeadline', () => {
  it('유휴 만료가 이르면 그것을 쓴다', () => {
    expect(earlierDeadline('2026-09-01T10:15:00Z', '2026-09-01T12:00:00Z'))
      .toBe(Date.parse('2026-09-01T10:15:00Z'))
  })

  it('절대 만료가 이르면 그것을 쓴다 — 2시간 끝자락', () => {
    expect(earlierDeadline('2026-09-01T12:10:00Z', '2026-09-01T12:00:00Z'))
      .toBe(Date.parse('2026-09-01T12:00:00Z'))
  })
})
