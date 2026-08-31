/**
 * AUTH_PASSWORD_HASH 값을 만든다.
 *
 *   npm run hash:password
 *
 * 출력값을 .env.local 과 버셀 환경변수에 넣는다.
 * 평문은 어디에도 저장되지 않는다.
 */
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../lib/auth/password.ts'

const rl = createInterface({ input: process.stdin, output: process.stdout })
const pw = await rl.question('비밀번호: ')
rl.close()

if (pw.length < 8) {
  console.error('\n8자 이상으로 정하세요.')
  process.exit(1)
}

console.log('\nAUTH_PASSWORD_HASH 에 아래 값을 넣으세요:\n')
console.log(hashPassword(pw))
console.log('\n이 값은 커밋해도 안전하지 않습니다. .env.local 에만 두세요.')
