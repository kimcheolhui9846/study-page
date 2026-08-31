import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../lib/auth/password'

describe('hashPassword', () => {
  it('평문을 포함하지 않는다', () => {
    expect(hashPassword('내비밀번호1234')).not.toContain('내비밀번호1234')
  })

  it('같은 비밀번호라도 매번 다른 해시를 만든다 — 솔트', () => {
    expect(hashPassword('같은거')).not.toBe(hashPassword('같은거'))
  })

  it('파라미터를 함께 저장한다 — 나중에 비용을 올려도 기존 해시를 검증할 수 있다', () => {
    expect(hashPassword('x')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/)
  })
})

describe('verifyPassword', () => {
  it('맞는 비밀번호를 통과시킨다', () => {
    expect(verifyPassword('올바른비밀번호', hashPassword('올바른비밀번호'))).toBe(true)
  })

  it('틀린 비밀번호를 막는다', () => {
    expect(verifyPassword('틀린비밀번호', hashPassword('올바른비밀번호'))).toBe(false)
  })

  it('한 글자 차이도 막는다', () => {
    expect(verifyPassword('abcdefh', hashPassword('abcdefg'))).toBe(false)
  })

  it('빈 문자열을 막는다 — 요청 본문이 비어 있을 때', () => {
    expect(verifyPassword('', hashPassword('진짜비밀번호'))).toBe(false)
  })

  it('유니코드 비밀번호를 처리한다', () => {
    const stored = hashPassword('한글비밀번호🔐')
    expect(verifyPassword('한글비밀번호🔐', stored)).toBe(true)
    expect(verifyPassword('한글비밀번호', stored)).toBe(false)
  })

  it('망가진 저장값에 던지지 않고 false 를 준다', () => {
    expect(verifyPassword('아무거나', '쓰레기값')).toBe(false)
    expect(verifyPassword('아무거나', '')).toBe(false)
    expect(verifyPassword('아무거나', 'scrypt$abc$def$ghi$jkl$mno')).toBe(false)
  })

  it('환경변수가 비었을 때 통과시키지 않는다 — 가장 위험한 실패 모드', () => {
    expect(verifyPassword('', '')).toBe(false)
    expect(verifyPassword('아무비밀번호', undefined as unknown as string)).toBe(false)
  })

  it('다른 알고리즘 태그를 거부한다', () => {
    expect(verifyPassword('x', 'argon2$1$2$3$c2FsdA$aGFzaA')).toBe(false)
  })
})
