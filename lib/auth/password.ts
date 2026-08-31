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
 * 형식: scrypt$N$r$p$salt$hash (salt/hash 는 base64url)
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$')
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

    const parts = stored.split('$')
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
