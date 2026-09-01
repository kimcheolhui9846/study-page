import { describe, it, expect } from 'vitest'
import {
  recoveryPhaseOf, isSchedulable, MAX_ATTEMPTS, PARK_DAYS,
  type RecoveryTarget,
} from '../../lib/mastery/recovery'

/**
 * 사용자가 정한 정책 (2026-09-02):
 *   "복습 기회는 1번 정도 주고, 복습할 때도 틀리면 그 하위 개념으로 공부하고,
 *    하위 개념 통과 시 다시 복습 진행 후, 맞든 틀리든 다음 학습 진도로 진행"
 */

const failing: RecoveryTarget[] = [{ id: 'a', score: 20, passThreshold: 75 }]
const passed: RecoveryTarget[] = [{ id: 'a', score: 90, passThreshold: 75 }]

const phase = (
  attemptCount: number,
  targets: RecoveryTarget[] = passed,
  daysSinceStudied: number | null = 1,
) => recoveryPhaseOf({ attemptCount, targets, daysSinceStudied }).phase

describe('회복 단계', () => {
  it('★ 첫 실패 뒤에는 스스로 한 번 더 — 사용자가 말한 "복습 기회 1번"', () => {
    expect(phase(1)).toBe('retry')
  })

  it('아직 한 번도 안 했으면 그냥 한다', () => {
    expect(phase(0)).toBe('retry')
  })

  it('★ 복습에서도 틀리면 하위 개념으로 내려간다', () => {
    expect(phase(2, failing)).toBe('remediation')
  })

  it('★ 하위를 통과했으면 다시 한 번 준다', () => {
    expect(phase(2, passed)).toBe('final-retry')
  })

  it('★ 그 뒤로는 결과와 무관하게 접어둔다 — 다음 진도로 간다', () => {
    expect(phase(MAX_ATTEMPTS, passed)).toBe('parked')
    expect(phase(MAX_ATTEMPTS, failing)).toBe('parked')
    expect(phase(10, failing)).toBe('parked')
  })

  it('★ 내려갈 하위가 아예 없으면 두 번째 실패에서 바로 접어둔다', () => {
    // 3번째 시도는 "하위 통과"를 조건으로 준 것이다. 통과할 하위가 없으면
    // 같은 문제를 한 번 더 푸는 것뿐이라 줄 이유가 없다.
    expect(phase(2, [])).toBe('parked')
  })

  it('내려갈 하위가 없어도 첫 복습 기회는 준다', () => {
    expect(phase(1, [])).toBe('retry')
  })
})

describe('접어둔 뒤', () => {
  it(`★ ${PARK_DAYS}일이 지나면 한 바퀴 다시 준다 — 영영 버리지 않는다`, () => {
    expect(phase(MAX_ATTEMPTS, failing, PARK_DAYS)).toBe('retry')
    expect(phase(MAX_ATTEMPTS, failing, PARK_DAYS + 30)).toBe('retry')
  })

  it('하루 전이면 아직 접어둔 채다', () => {
    expect(phase(MAX_ATTEMPTS, failing, PARK_DAYS - 1)).toBe('parked')
  })

  it('내려갈 하위가 없어 접어둔 것도 똑같이 돌아온다', () => {
    expect(phase(2, [], PARK_DAYS)).toBe('retry')
  })

  it('공부한 적이 없으면 접어둘 일도 없다', () => {
    expect(phase(0, failing, null)).toBe('retry')
  })
})

describe('내려갈 하위 개념', () => {
  it('못 넘긴 것만 고른다', () => {
    const r = recoveryPhaseOf({
      attemptCount: 2,
      targets: [
        { id: 'ok', score: 90, passThreshold: 75 },
        { id: 'bad', score: 10, passThreshold: 75 },
      ],
      daysSinceStudied: 1,
    })
    expect(r.phase).toBe('remediation')
    expect(r.blocking.map((t) => t.id)).toEqual(['bad'])
  })

  it('점수가 낮은 것부터 — 가장 밑바닥을 먼저 메운다', () => {
    const r = recoveryPhaseOf({
      attemptCount: 2,
      targets: [
        { id: 'mid', score: 50, passThreshold: 75 },
        { id: 'low', score: 10, passThreshold: 75 },
      ],
      daysSinceStudied: 1,
    })
    expect(r.blocking.map((t) => t.id)).toEqual(['low', 'mid'])
  })

  it('기준은 Topic 마다 다르다 — 각자의 passThreshold 를 본다', () => {
    const r = recoveryPhaseOf({
      attemptCount: 2,
      targets: [{ id: 'a', score: 70, passThreshold: 60 }],
      daysSinceStudied: 1,
    })
    expect(r.phase).toBe('final-retry')
  })
})

describe('isSchedulable', () => {
  it('접어둔 것만 일정에서 빠진다', () => {
    expect(isSchedulable('parked')).toBe(false)
    for (const p of ['retry', 'remediation', 'final-retry'] as const) {
      expect(isSchedulable(p)).toBe(true)
    }
  })
})
