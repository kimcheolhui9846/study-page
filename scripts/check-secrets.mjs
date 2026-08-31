import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 클라이언트 번들에 도달할 수 있는 디렉터리만 검사한다.
 *
 * tests/ 와 scripts/ 는 번들되지 않으므로 검사하지 않는다.
 * (이 검사기의 테스트는 NEXT_PUBLIC_ 을 픽스처로 쓴다 — 그건 위반이 아니다)
 */
const SCAN_DIRS = ['app', 'components', 'lib']
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

/**
 * NEXT_PUBLIC_ 사용을 찾는다.
 *
 * 이 프로젝트는 NEXT_PUBLIC_ 환경변수를 0개로 유지한다.
 * 접두사가 붙는 순간 값이 클라이언트 번들에 박혀 공개되므로,
 * 비밀에만 예외를 두는 대신 아예 하나도 쓰지 않는 쪽이 검사가 단순하고 안전하다.
 */
export function findViolations(root) {
  const out = []

  for (const dirName of SCAN_DIRS) {
    const dir = join(root, dirName)
    if (existsSync(dir)) walk(dir)
  }

  return out

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!EXT.test(name)) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((text, i) => {
        if (text.includes('NEXT_PUBLIC_')) {
          out.push({ file: relative(root, full), line: i + 1, text: text.trim() })
        }
      })
    }
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const violations = findViolations(process.cwd())
  if (violations.length > 0) {
    console.error('NEXT_PUBLIC_ 환경변수가 발견되었습니다. 이 프로젝트는 0개를 유지합니다.\n')
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
    process.exit(1)
  }
  console.log('OK — NEXT_PUBLIC_ 없음')
}
