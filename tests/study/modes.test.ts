import { describe, it, expect } from 'vitest'
import { MODES, STUDY_MODES, getMode, isStudyMode } from '../../lib/study/modes'
import { NO_RUNNER } from '../../lib/study/runner'

describe('모드 하네스', () => {
  it('영어·수학·CS·코테 네 개다', () => {
    expect([...STUDY_MODES]).toEqual(['english', 'math', 'cs', 'coding'])
    for (const m of STUDY_MODES) expect(getMode(m).id).toBe(m)
  })

  it.each(STUDY_MODES)('%s — 활동·예시가 둘 이상이고 활동 id 가 유일하다', (m) => {
    const h = MODES[m]
    expect(h.activities.length).toBeGreaterThanOrEqual(2)
    expect(h.examples.length).toBeGreaterThanOrEqual(2)
    expect(new Set(h.activities.map((a) => a.id)).size).toBe(h.activities.length)
    for (const field of [h.teaching, h.materialRules, h.feedbackRules, h.claimRules]) {
      expect(field.trim().length).toBeGreaterThan(20)
    }
  })

  it('★ 코테는 기본이 「오류만」이고 판정 라벨이 「AI 코드 검토」다', () => {
    expect(MODES.coding.defaultFeedbackMode).toBe('errors-only')
    expect(MODES.coding.reviewLabel).toBe('AI 코드 검토')
  })

  it('★ 코테는 실행·통과·AC 를 주장하지 않는다', () => {
    expect(MODES.coding.claimRules).toMatch(/실행/)
    expect(MODES.coding.claimRules).toMatch(/AC/)
    expect(MODES.coding.materialRules).toMatch(/백준/)
  })

  it('★ 코테 생성 문제는 입력·출력·제약·예시를 갖추라고 한다', () => {
    for (const w of ['입력', '출력', '제약', '예시']) {
      expect(MODES.coding.materialRules).toContain(w)
    }
  })

  it('★ 수학은 도구로 검산했다고 말하지 않는다', () => {
    expect(MODES.math.claimRules).toMatch(/검산/)
    expect(MODES.math.reviewLabel).toBe('AI 검토')
  })

  it('★ 영어는 듣기·발음을 평가했다고 말하지 않는다', () => {
    expect(MODES.english.claimRules).toMatch(/발음/)
  })

  it('★ 영어 자료 주제를 AI·기술에 고정하지 않는다', () => {
    expect(MODES.english.materialRules).toMatch(/AI·기술/)
  })

  it('★ CS 는 직접 설명을 퀴즈로 바꾸지 않는다', () => {
    expect(MODES.cs.teaching).toMatch(/퀴즈/)
  })

  it('isStudyMode 는 네 값만 받는다', () => {
    expect(isStudyMode('math')).toBe(true)
    expect(isStudyMode('physics')).toBe(false)
    expect(isStudyMode(undefined)).toBe(false)
  })

  it('코드 실행기는 없다 — 경계만 있다', () => {
    expect(NO_RUNNER.available).toBe(false)
  })
})
