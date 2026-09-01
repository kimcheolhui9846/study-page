import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * `OPENAI_API_KEY` 는 lib/llm/client.ts 한 곳에서만 읽는다 (CLAUDE.md).
 *
 * 1주차에는 이 파일이 "LLM 을 아예 연결하지 않았다"를 강제했다. 2주차에
 * 연결하면서 감시 대상을 바꿨다 — 지우지 않고 키가 새는 경로를 막는 쪽으로.
 *
 * 키가 여러 곳에서 읽히면 어디서 새는지 추적할 수 없고, 클라이언트
 * 컴포넌트에 잘못 import 되면 번들에 실린다. 한 곳으로 좁히면
 * 그 파일 하나만 보면 된다.
 */
const KEY_READ = /process\.env\.OPENAI_API_KEY/
const ALLOWED = 'lib/llm/client.ts'

const SCAN_DIRS = ['app', 'components', 'lib']
const EXT = /\.(ts|tsx|js|jsx|mjs)$/

function scan(root: string) {
  const hits: string[] = []

  for (const dirName of SCAN_DIRS) {
    const dir = join(root, dirName)
    if (existsSync(dir)) walk(dir)
  }
  return hits

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!EXT.test(name)) continue
      if (KEY_READ.test(readFileSync(full, 'utf8'))) {
        hits.push(relative(root, full).replaceAll('\\', '/'))
      }
    }
  }
}

describe('API 키의 경계', () => {
  it('★ OPENAI_API_KEY 는 lib/llm/client.ts 에서만 읽는다', () => {
    const hits = scan(process.cwd()).sort()
    expect(hits, `키를 읽는 파일: ${hits.join(', ') || '(없음)'}`).toEqual([ALLOWED])
  })

  it('openai 패키지를 의존성에 넣지 않는다 — fetch 로 직접 부른다', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
      .not.toContain('openai')
  })

  it('FakeLlmClient 가 남아 있다 — 모든 통합 테스트가 이걸 주입한다', async () => {
    const fake = await import('../lib/llm/fake')
    expect(Object.keys(fake).sort()).toEqual(['FailingLlmClient', 'FakeLlmClient'])
  })
})
