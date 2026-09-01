import { describe, it, expect } from 'vitest'
import { masteryScore, countPoints } from '../../lib/mastery/score'
import { outcomeFor, isUnlocked, blockingPrerequisites } from '../../lib/mastery/transition'
import { scheduleNext, resetSchedule, isDue, daysOverdue } from '../../lib/mastery/schedule'

const base = {
  correctPoints: 0, missedPoints: 0, difficulty: 3,
  usedHint: false, repeatedMistake: false,
}

describe('masteryScore', () => {
  it('전부 맞으면 100 에 가깝다 (난이도 3 기준 보정 포함)', () => {
    const s = masteryScore({ ...base, correctPoints: 3, missedPoints: 0 })
    expect(s).toBeGreaterThanOrEqual(100)
  })

  it('★ 전부 놓치면 0 이다 — 모델이 50 을 줬던 그 경우', () => {
    expect(masteryScore({ ...base, correctPoints: 0, missedPoints: 3 })).toBe(0)
  })

  it('절반 맞으면 절반쯤이다', () => {
    const s = masteryScore({ ...base, correctPoints: 3, missedPoints: 3 })
    expect(s).toBeGreaterThan(40)
    expect(s).toBeLessThan(60)
  })

  it('★ 힌트를 봤으면 낮다 — 스스로 떠올린 것과 같게 볼 수 없다', () => {
    const withHint = masteryScore({ ...base, correctPoints: 2, missedPoints: 2, usedHint: true })
    const without = masteryScore({ ...base, correctPoints: 2, missedPoints: 2 })
    expect(withHint).toBeLessThan(without)
  })

  it('★ 반복해 틀렸으면 낮다 — 이번에 맞았어도 아직 굳지 않았다', () => {
    const repeated = masteryScore({ ...base, correctPoints: 2, missedPoints: 2, repeatedMistake: true })
    const first = masteryScore({ ...base, correctPoints: 2, missedPoints: 2 })
    expect(repeated).toBeLessThan(first)
  })

  it('★ 어려운 문제를 맞히면 높다', () => {
    const hard = masteryScore({ ...base, correctPoints: 2, missedPoints: 2, difficulty: 5 })
    const easy = masteryScore({ ...base, correctPoints: 2, missedPoints: 2, difficulty: 1 })
    expect(hard).toBeGreaterThan(easy)
  })

  it('★ 한 번의 실수로 숙달이 무너지지 않는다', () => {
    // 90점이던 사람이 오늘 다 틀렸다 → 0 이 아니라 36
    const after = masteryScore({ ...base, correctPoints: 0, missedPoints: 3, previousScore: 90 })
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(60)
  })

  it('이전 점수가 있으면 이번 결과가 더 무겁다 (0.4 : 0.6)', () => {
    const s = masteryScore({ ...base, correctPoints: 3, missedPoints: 0, previousScore: 0 })
    expect(s).toBeGreaterThan(50) // 이번 100 이 이전 0 을 끌어올린다
  })

  it('0~100 을 벗어나지 않는다', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const s = masteryScore({ ...base, correctPoints: 10, missedPoints: 0, difficulty: d })
      expect(s).toBeLessThanOrEqual(100)
      expect(s).toBeGreaterThanOrEqual(0)
    }
  })

  it('★ 채점이 포인트를 하나도 못 냈으면 이전 점수를 지킨다 — 0 이 아니라 미평가다', () => {
    expect(masteryScore({ ...base, previousScore: 80 })).toBe(80)
    expect(masteryScore({ ...base })).toBe(0)
  })
})

describe('countPoints', () => {
  it('문제별 포인트를 Topic 하나로 합산한다', () => {
    expect(countPoints([
      { correct_points: ['a', 'b'], missed_points: ['c'] },
      { correct_points: ['d'], missed_points: [] },
    ])).toEqual({ correctPoints: 3, missedPoints: 1 })
  })
})

describe('outcomeFor', () => {
  it('90 이상은 숙달하고 나아간다', () => {
    const o = outcomeFor(95)
    expect(o.status).toBe('mastered')
    expect(o.advances).toBe(true)
    expect(o.scheduleSpacedReview).toBe(true)
  })

  it('75~89 도 나아간다', () => {
    expect(outcomeFor(80).advances).toBe(true)
  })

  it('★ 60~74 는 나아가되 내일 복습한다', () => {
    const o = outcomeFor(65)
    expect(o.advances).toBe(true)
    expect(o.reviewTomorrow).toBe(true)
    expect(o.status).toBe('reviewing')
  })

  it('★ 60 미만은 진도를 멈추고 보충을 찾는다', () => {
    for (const s of [55, 30, 0]) {
      const o = outcomeFor(s)
      expect(o.advances, `${s}점에서 나아가면 안 된다`).toBe(false)
      expect(o.needsRemediation).toBe(true)
      expect(o.status).toBe('weak')
    }
  })

  it('경계값에서 흔들리지 않는다', () => {
    expect(outcomeFor(90).status).toBe('mastered')
    expect(outcomeFor(75).advances).toBe(true)
    expect(outcomeFor(74).status).toBe('reviewing')
    expect(outcomeFor(60).advances).toBe(true)
    expect(outcomeFor(59).advances).toBe(false)
  })
})

describe('isUnlocked / blockingPrerequisites', () => {
  it('선수가 없으면 열려 있다', () => {
    expect(isUnlocked([])).toBe(true)
  })

  it('선수가 전부 기준을 넘어야 열린다', () => {
    expect(isUnlocked([{ score: 80, passThreshold: 75 }])).toBe(true)
    expect(isUnlocked([{ score: 70, passThreshold: 75 }])).toBe(false)
  })

  it('하나라도 모자라면 막힌다', () => {
    expect(isUnlocked([
      { score: 90, passThreshold: 75 },
      { score: 50, passThreshold: 75 },
    ])).toBe(false)
  })

  it('막고 있는 선수만 골라낸다 — 보충 후보이자 화면의 설명', () => {
    const blocking = blockingPrerequisites([
      { id: 'a', score: 90, passThreshold: 75 },
      { id: 'b', score: 50, passThreshold: 75 },
    ])
    expect(blocking.map((p) => p.id)).toEqual(['b'])
  })
})

describe('복습 예약', () => {
  const now = new Date('2026-09-01T01:00:00Z') // KST 2026-09-01
  const intervals = [1, 3, 7, 14]

  it('첫 예약은 1일 뒤다', () => {
    expect(scheduleNext({ round: 0, nextReviewAt: null }, intervals, now))
      .toEqual({ round: 1, nextReviewAt: '2026-09-02' })
  })

  it('회차마다 간격이 벌어진다', () => {
    expect(scheduleNext({ round: 1, nextReviewAt: null }, intervals, now).nextReviewAt)
      .toBe('2026-09-04') // +3
    expect(scheduleNext({ round: 2, nextReviewAt: null }, intervals, now).nextReviewAt)
      .toBe('2026-09-08') // +7
    expect(scheduleNext({ round: 3, nextReviewAt: null }, intervals, now).nextReviewAt)
      .toBe('2026-09-15') // +14
  })

  it('★ 마지막 회차를 마치면 더 예약하지 않는다 — 복습 생성의 상한', () => {
    const done = scheduleNext({ round: 4, nextReviewAt: null }, intervals, now)
    expect(done.nextReviewAt).toBeNull()
    expect(done.round).toBe(4)
  })

  it('★ 다시 틀리면 처음부터 시작한다 — 방금 틀린 걸 2주 뒤에 보는 건 방치다', () => {
    expect(resetSchedule(intervals, now)).toEqual({ round: 1, nextReviewAt: '2026-09-02' })
  })

  it('★ 월 경계를 넘어도 날짜가 맞다', () => {
    const end = new Date('2026-09-30T01:00:00Z') // KST 09-30
    expect(scheduleNext({ round: 0, nextReviewAt: null }, intervals, end).nextReviewAt)
      .toBe('2026-10-01')
  })

  it('★ KST 기준으로 오늘을 잡는다 — UTC 가 아니라', () => {
    // UTC 2026-09-01 15:30 = KST 2026-09-02 00:30
    const afterMidnight = new Date('2026-09-01T15:30:00Z')
    expect(scheduleNext({ round: 0, nextReviewAt: null }, intervals, afterMidnight).nextReviewAt)
      .toBe('2026-09-03')
  })
})

describe('isDue / daysOverdue', () => {
  const now = new Date('2026-09-05T01:00:00Z') // KST 2026-09-05

  it('예정 없으면 기한이 아니다', () => {
    expect(isDue(null, now)).toBe(false)
    expect(daysOverdue(null, now)).toBe(0)
  })

  it('오늘이면 기한이다', () => {
    expect(isDue('2026-09-05', now)).toBe(true)
    expect(daysOverdue('2026-09-05', now)).toBe(0)
  })

  it('지났으면 밀린 날 수를 센다', () => {
    expect(isDue('2026-09-02', now)).toBe(true)
    expect(daysOverdue('2026-09-02', now)).toBe(3)
  })

  it('아직 안 됐으면 기한이 아니고 밀림도 0 이다', () => {
    expect(isDue('2026-09-10', now)).toBe(false)
    expect(daysOverdue('2026-09-10', now)).toBe(0)
  })
})
