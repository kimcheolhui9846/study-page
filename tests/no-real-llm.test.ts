import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 1주차의 완료 기준은 "실제 LLM 호출 0회"다.
 *
 * 그걸 사람의 기억이 아니라 검사로 강제한다. 2주차에 진짜 클라이언트를 붙일 때
 * 이 테스트가 빨갛게 뜨는 것이 곧 "이제 돈이 나가기 시작한다"는 신호다.
 * 그때 이 파일을 지우면서, 대시보드 하드 리밋이 걸려 있는지 함께 확인할 것.
 *
 * 주석으로 OpenAI 를 언급하는 것은 막지 않는다 — 그건 설명이지 호출이 아니다.
 * 코드에서만 나타날 수 있는 형태를 찾는다.
 */
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /from\s+['"]openai['"]/,        why: "openai 패키지 import" },
  { re: /require\(\s*['"]openai['"]\s*\)/, why: 'openai 패키지 require' },
  { re: /process\.env\.OPENAI_API_KEY/, why: 'API 키 읽기' },
  { re: /api\.openai\.com/,             why: 'API 엔드포인트 직접 호출' },
]

const SCAN_DIRS = ['app', 'lib']
const EXT = /\.(ts|tsx|js|jsx|mjs)$/

function scan(root: string) {
  const out: Array<{ file: string; line: number; why: string; text: string }> = []

  for (const dirName of SCAN_DIRS) {
    const dir = join(root, dirName)
    if (existsSync(dir)) walk(dir)
  }
  return out

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!EXT.test(name)) continue

      readFileSync(full, 'utf8').split('\n').forEach((text, i) => {
        for (const { re, why } of FORBIDDEN) {
          if (re.test(text)) {
            out.push({ file: relative(root, full), line: i + 1, why, text: text.trim() })
          }
        }
      })
    }
  }
}

describe('1주차: 실제 LLM 을 연결하지 않는다', () => {
  it('app/ 과 lib/ 어디에서도 OpenAI 를 import 하거나 키를 읽지 않는다', () => {
    const found = scan(process.cwd())
    expect(
      found,
      `실제 LLM 연결이 발견되었습니다:\n${found.map((f) => `  ${f.file}:${f.line}  [${f.why}] ${f.text}`).join('\n')}`,
    ).toEqual([])
  })

  it('openai 패키지가 의존성에 없다 — 없으면 부를 수도 없다', async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(all)).not.toContain('openai')
  })

  it('LlmClient 의 구현체는 가짜뿐이다', async () => {
    const fake = await import('../lib/llm/fake')
    expect(Object.keys(fake).sort()).toEqual(['FailingLlmClient', 'FakeLlmClient'])
  })
})
