import { describe, it, expect } from 'vitest'
import { hashPassword, isHashFormatValid, verifyPassword } from '../../lib/auth/password'

describe('hashPassword', () => {
  it('평문을 포함하지 않는다', () => {
    expect(hashPassword('내비밀번호1234')).not.toContain('내비밀번호1234')
  })

  it('같은 비밀번호라도 매번 다른 해시를 만든다 — 솔트', () => {
    expect(hashPassword('같은거')).not.toBe(hashPassword('같은거'))
  })

  it('파라미터를 함께 저장한다 — 나중에 비용을 올려도 기존 해시를 검증할 수 있다', () => {
    expect(hashPassword('x')).toMatch(/^scrypt\.\d+\.\d+\.\d+\.[\w-]+\.[\w-]+$/)
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
    expect(verifyPassword('아무거나', 'scrypt.abc.def.ghi.jkl.mno')).toBe(false)
  })

  it('환경변수가 비었을 때 통과시키지 않는다 — 가장 위험한 실패 모드', () => {
    expect(verifyPassword('', '')).toBe(false)
    expect(verifyPassword('아무비밀번호', undefined as unknown as string)).toBe(false)
  })

  it('다른 알고리즘 태그를 거부한다', () => {
    expect(verifyPassword('x', 'argon2$1$2$3$c2FsdA$aGFzaA')).toBe(false)
  })
})

/**
 * ★ 이 블록이 실제 사고에서 나왔다.
 *
 * 구분자가 '$' 이던 시절, Next 의 dotenv 로더가 '$16384' 같은 조각을
 * 환경변수 참조로 보고 빈 문자열로 치환했다. 파일에는 멀쩡한 값이 있는데
 * 앱이 읽는 값은 망가져 있었고, 모든 비밀번호가 조용히 거부됐다.
 * 원인을 찾는 데 오래 걸린 이유는 "틀렸다"와 "설정이 깨졌다"가
 * 화면에서 똑같이 보였기 때문이다.
 */
describe('환경변수로 실어 나를 수 있는 형식인가', () => {
  it('해시에 $ 가 들어가지 않는다 — dotenv 변수 확장에 먹힌다', () => {
    expect(hashPassword('비밀번호12345')).not.toContain('$')
  })

  it('셸과 dotenv 에서 특별한 뜻을 갖는 문자가 없다', () => {
    // base64url(A-Za-z0-9_-) 과 구분자 '.' 그리고 숫자만 나와야 한다.
    // 여기 걸리는 문자가 하나라도 있으면 .env 나 셸을 거치며 값이 변형될 수 있다.
    expect(hashPassword('비밀번호12345')).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('base64url 알파벳과 구분자가 겹치지 않는다', () => {
    // A-Za-z0-9_- 만 쓰므로 '.' 로 자르면 정확히 6조각이다
    expect(hashPassword('비밀번호12345').split('.')).toHaveLength(6)
  })
})

describe('isHashFormatValid', () => {
  it('정상 해시를 통과시킨다', () => {
    expect(isHashFormatValid(hashPassword('비밀번호12345'))).toBe(true)
  })

  it('빈 값과 망가진 값을 거른다', () => {
    expect(isHashFormatValid('')).toBe(false)
    expect(isHashFormatValid('scrypt6384-bda_kLQQrOKzgA')).toBe(false) // 실제로 나왔던 값
    expect(isHashFormatValid('scrypt$16384$8$1$a$b')).toBe(false)      // 옛 형식
    expect(isHashFormatValid('bcrypt.16384.8.1.a.b')).toBe(false)
  })
})
