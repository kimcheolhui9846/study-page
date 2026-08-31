import { describe, it, expect } from 'vitest'
import { CurriculumSchema, SUBJECTS } from '../lib/curriculum/schema'
import { loadCurriculum, getDay, loadAll } from '../lib/curriculum/load'

const validDay = {
  day: 1,
  topic: '프로세스와 스레드',
  goal: '컨텍스트 스위칭 비용이 왜 발생하는지 설명할 수 있다',
  keywords: ['PCB', '컨텍스트 스위칭'],
  difficulty: 2,
}

const valid = { subject: 'cs', label: '컴퓨터 과학', days: [validDay] }

describe('CurriculumSchema', () => {
  it('올바른 커리큘럼을 통과시킨다', () => {
    expect(() => CurriculumSchema.parse(valid)).not.toThrow()
  })

  it('day 번호가 1부터 시작하지 않으면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, day: 2 }] }))
      .toThrow(/1부터 연속/)
  })

  it('day 번호에 구멍이 있으면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [validDay, { ...validDay, day: 3 }] }))
      .toThrow(/1부터 연속/)
  })

  it('day 번호가 중복되면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [validDay, { ...validDay, day: 1 }] }))
      .toThrow(/1부터 연속/)
  })

  it('goal 이 비면 거부한다 — goal 은 채점 기준이라 필수다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, goal: '' }] })).toThrow()
  })

  it('topic 이 비면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, topic: '' }] })).toThrow()
  })

  it('keywords 가 비면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, keywords: [] }] })).toThrow()
  })

  it('difficulty 가 범위를 벗어나면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, difficulty: 6 }] })).toThrow()
    expect(() => CurriculumSchema.parse({ ...valid, days: [{ ...validDay, difficulty: 0 }] })).toThrow()
  })

  it('모르는 과목을 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, subject: 'physics' })).toThrow()
  })

  it('days 가 비면 거부한다', () => {
    expect(() => CurriculumSchema.parse({ ...valid, days: [] })).toThrow()
  })
})

describe('실제 커리큘럼 파일', () => {
  it('세 과목 모두 로드되고 검증을 통과한다', () => {
    expect(Object.keys(loadAll()).sort()).toEqual([...SUBJECTS].sort())
  })

  it('세 과목 모두 Day 1~7 이 있다', () => {
    for (const subject of SUBJECTS) {
      expect(loadCurriculum(subject).days.length).toBeGreaterThanOrEqual(7)
    }
  })

  it('파일의 subject 가 파일명과 일치한다', () => {
    for (const subject of SUBJECTS) {
      expect(loadCurriculum(subject).subject).toBe(subject)
    }
  })

  it('모든 Day 에 goal 이 있다 — 없으면 채점 기준이 없다', () => {
    for (const subject of SUBJECTS) {
      for (const day of loadCurriculum(subject).days) {
        expect(day.goal.length).toBeGreaterThan(0)
      }
    }
  })

  it('getDay 는 있는 Day 를 주고 없는 Day 에 null 을 준다', () => {
    expect(getDay('cs', 1)?.day).toBe(1)
    expect(getDay('cs', 9999)).toBeNull()
  })

  it('getDay 는 요청한 번호의 Day 를 준다', () => {
    const day3 = getDay('english', 3)
    expect(day3?.day).toBe(3)
    expect(day3?.topic.length).toBeGreaterThan(0)
  })
})
