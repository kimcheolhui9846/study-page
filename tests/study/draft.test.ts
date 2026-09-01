import { describe, it, expect, beforeEach, vi } from 'vitest'
import { draftKey, loadDraft, saveDraft, clearDraft } from '../../lib/study/draft'

/** localStorage 를 흉내낸다. 접근 자체가 던지는 환경도 만든다. */
function fakeStorage(throwOnAccess = false) {
  const map = new Map<string, string>()
  const guard = () => { if (throwOnAccess) throw new Error('blocked') }
  return {
    getItem: (k: string) => { guard(); return map.get(k) ?? null },
    setItem: (k: string, v: string) => { guard(); map.set(k, v) },
    removeItem: (k: string) => { guard(); map.delete(k) },
  }
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('draftKey', () => {
  it('Topic 으로 키를 나눈다 — 초안이 섞이지 않는다', () => {
    expect(draftKey('cs.a.t5')).not.toBe(draftKey('math.a.t5'))
    expect(draftKey('cs.a.t5')).not.toBe(draftKey('cs.a.t6'))
  })
})

describe('초안 보관', () => {
  it('저장한 것을 그대로 돌려준다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveDraft('cs.a.t1', { q1: '답 하나', q2: '', q3: '' })
    expect(loadDraft('cs.a.t1')).toEqual({ q1: '답 하나', q2: '', q3: '' })
  })

  it('없으면 빈 객체다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadDraft('cs.a.t1')).toEqual({})
  })

  it('지우면 사라진다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveDraft('cs.a.t1', { q1: '답' })
    clearDraft('cs.a.t1')
    expect(loadDraft('cs.a.t1')).toEqual({})
  })

  it('한 과목을 지워도 다른 과목은 남는다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveDraft('cs.a.t1', { q1: 'CS 답' })
    saveDraft('math.a.t1', { q1: '수학 답' })
    clearDraft('cs.a.t1')
    expect(loadDraft('cs.a.t1')).toEqual({})
    expect(loadDraft('math.a.t1')).toEqual({ q1: '수학 답' })
  })

  /**
   * ★ 사생활 보호 모드나 사이트 데이터 차단에서는 localStorage 접근
   * 자체가 던진다. 초안은 편의 기능이므로 실패해도 화면이 죽으면 안 된다.
   */
  it('★ localStorage 가 막힌 환경에서도 던지지 않는다', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => saveDraft('cs.a.t1', { q1: '답' })).not.toThrow()
    expect(loadDraft('cs.a.t1')).toEqual({})
    expect(() => clearDraft('cs.a.t1')).not.toThrow()
  })

  it('망가진 JSON 이 들어 있어도 빈 객체를 준다', () => {
    const s = fakeStorage()
    s.setItem(draftKey('cs.a.t1'), '{깨진')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('cs.a.t1')).toEqual({})
  })

  it('배열이 들어 있어도 빈 객체를 준다 — 배열도 typeof object 다', () => {
    const s = fakeStorage()
    s.setItem(draftKey('cs.a.t1'), '[1,2,3]')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('cs.a.t1')).toEqual({})
  })

  it('null 이 들어 있어도 빈 객체를 준다', () => {
    const s = fakeStorage()
    s.setItem(draftKey('cs.a.t1'), 'null')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('cs.a.t1')).toEqual({})
  })
})
