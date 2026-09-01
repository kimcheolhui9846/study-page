import { describe, it, expect } from 'vitest'
import { kstToday, kstMonth, kstDateLabel } from '../lib/time'
import { fixedClock } from './helpers/clock'

describe('kstToday', () => {
  it('UTC 14:59 는 같은 날 (KST 23:59)', () => {
    expect(kstToday(new Date('2026-08-31T14:59:59Z'))).toBe('2026-08-31')
  })

  it('UTC 15:00 은 다음 날 (KST 00:00) — 버셀 UTC 함정', () => {
    expect(kstToday(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09-01')
  })

  it('UTC 자정은 아직 같은 날 (KST 09:00)', () => {
    expect(kstToday(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01')
  })

  it('UTC 08:59 는 아직 같은 날 (KST 17:59)', () => {
    expect(kstToday(new Date('2026-09-01T08:59:59Z'))).toBe('2026-09-01')
  })

  it('월말을 넘어간다', () => {
    expect(kstToday(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10-01')
  })

  it('연말을 넘어간다', () => {
    expect(kstToday(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })

  it('윤년 2월 29일을 처리한다', () => {
    expect(kstToday(new Date('2028-02-28T15:00:00Z'))).toBe('2028-02-29')
  })

  it('항상 YYYY-MM-DD 형식이다', () => {
    expect(kstToday(new Date('2026-01-05T02:00:00Z'))).toBe('2026-01-05')
  })
})

describe('kstMonth', () => {
  it('KST 기준 월을 준다', () => {
    expect(kstMonth(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09')
    expect(kstMonth(new Date('2026-08-31T14:00:00Z'))).toBe('2026-08')
  })

  it('kstToday 와 같은 경계를 쓴다', () => {
    const boundary = new Date('2026-11-30T15:00:00Z')
    expect(kstMonth(boundary)).toBe(kstToday(boundary).slice(0, 7))
  })
})

describe('fixedClock', () => {
  it('고정된 시각을 준다', () => {
    const clock = fixedClock('2026-09-01T00:00:00Z')
    expect(clock.now().toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('advance 로 시간을 밀 수 있다', () => {
    const clock = fixedClock('2026-09-01T00:00:00Z')
    clock.advance(60_000)
    expect(clock.now().toISOString()).toBe('2026-09-01T00:01:00.000Z')
  })

  it('sleep 없이 2시간을 흘려보낸다 — 절대 만료 테스트가 이걸 쓴다', () => {
    const clock = fixedClock('2026-09-01T00:00:00Z')
    clock.advance(2 * 60 * 60 * 1000)
    expect(clock.now().toISOString()).toBe('2026-09-01T02:00:00.000Z')
  })

  it('매번 새 Date 를 준다 — 호출자가 변형해도 시계가 안 망가진다', () => {
    const clock = fixedClock('2026-09-01T00:00:00Z')
    const first = clock.now()
    first.setFullYear(1999)
    expect(clock.now().toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('kstDateLabel', () => {
  it('KST 날짜와 요일을 준다', () => {
    // 2026-09-01 은 화요일
    expect(kstDateLabel(new Date('2026-09-01T01:00:00Z'))).toBe('2026 · 09 · 01  화')
  })

  it('★ UTC 자정 이전에도 KST 날짜를 준다', () => {
    // UTC 2026-08-31 15:30 = KST 2026-09-01 00:30 (화)
    expect(kstDateLabel(new Date('2026-08-31T15:30:00Z'))).toBe('2026 · 09 · 01  화')
    // UTC 2026-08-31 14:30 = KST 2026-08-31 23:30 (월)
    expect(kstDateLabel(new Date('2026-08-31T14:30:00Z'))).toBe('2026 · 08 · 31  월')
  })
})
