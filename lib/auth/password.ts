import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt 비용 파라미터. 저장값에 함께 넣으므로 나중에 올려도 기존 해시를 검증할 수 있다.
const N = 16384 // CPU/메모리 비용
const R = 8
const P = 1
const KEYLEN = 32

/**
 * 비밀번호를 scrypt 로 해시한다.
 *
 * argon2 대신 node:crypto 의 scrypt 를 쓴다 — argon2 패키지들은 네이티브 모듈이라
 * 버셀 서버리스 번들링에서 깨질 위험이 있다. scrypt 는 표준 라이브러리이고
 * 메모리 하드 KDF 로서 비밀번호 하나를 지키기에 충분하다.
 *
 * 형식: scrypt.N.r.p.salt.hash (salt/hash 는 base64url)
 *
 * ★ 구분자가 '$' 가 아니라 '.' 인 이유가 있다.
 *
 * Next 의 dotenv 로더는 변수 확장을 한다. 값에 '$16384' 가 들어 있으면
 * 그것을 환경변수 참조로 보고 빈 문자열로 치환해 버린다. 그러면 앱이 읽는
 * AUTH_PASSWORD_HASH 는 파일에 적힌 값과 다른, 망가진 문자열이 되고
 * 모든 비밀번호가 조용히 거부된다 (실제로 겪었다 — DECISIONS 참조).
 *
 * .env.local 에서는 작은따옴표로 감싸면 피할 수 있지만, 버셀 대시보드는
 * 따옴표를 값의 일부로 저장하므로 거기서 또 깨진다. 어디에 넣어도 안전한
 * 구분자를 쓰는 것이 유일하게 일관된 해법이다.
 *
 * base64url 알파벳은 A-Za-z0-9_- 라서 '.' 과 겹치지 않는다.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('.')
}

/**
 * 저장된 해시가 형식을 갖췄는지만 본다. 비밀번호는 보지 않는다.
 *
 * 설정이 망가진 것과 비밀번호가 틀린 것은 완전히 다른 사고인데
 * verifyPassword 는 둘 다 false 로 답한다. 그 둘을 서버 로그에서
 * 구분하려고 이 함수가 있다. 응답에는 절대 반영하지 않는다 —
 * 설정 상태를 밖에 알려줄 이유가 없다.
 */
export function isHashFormatValid(stored: string): boolean {
  if (typeof stored !== 'string') return false
  const parts = stored.split('.')
  return parts.length === 6 && parts[0] === 'scrypt'
}

/**
 * 비밀번호를 검증한다. 어떤 이유로든 확신할 수 없으면 false 다.
 *
 * 특히 stored 가 비어 있을 때(AUTH_PASSWORD_HASH 미설정) 반드시 false 여야 한다.
 * 여기서 true 가 나오면 인증이 통째로 무력화된다.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  try {
    if (typeof plain !== 'string' || typeof stored !== 'string' || stored.length === 0) {
      return false
    }

    const parts = stored.split('.')
    if (parts.length !== 6) return false

    const [tag, nStr, rStr, pStr, saltB64, hashB64] = parts
    if (tag !== 'scrypt') return false

    const n = Number(nStr)
    const r = Number(rStr)
    const p = Number(pStr)
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    if (salt.length === 0 || expected.length !== KEYLEN) return false

    const actual = scryptSync(plain, salt, KEYLEN, { N: n, r, p })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
