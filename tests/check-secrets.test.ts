import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findViolations } from '../scripts/check-secrets.mjs'

let dir: string

function write(relPath: string, content: string) {
  const parts = relPath.split('/')
  mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true })
  writeFileSync(join(dir, ...parts), content)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secrets-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('findViolations', () => {
  it('NEXT_PUBLIC_ 이 없으면 위반이 없다', () => {
    write('lib/a.ts', 'const key = process.env.OPENAI_API_KEY')
    expect(findViolations(dir)).toEqual([])
  })

  it('NEXT_PUBLIC_ 을 파일과 줄번호까지 찾아낸다', () => {
    write('lib/b.ts', 'const a = 1\nconst k = process.env.NEXT_PUBLIC_KEY\n')
    const found = findViolations(dir)
    expect(found).toHaveLength(1)
    expect(found[0].line).toBe(2)
    expect(found[0].file).toContain('b.ts')
  })

  it('app 과 components 도 검사한다 — 클라이언트 번들에 도달한다', () => {
    write('app/page.tsx', 'process.env.NEXT_PUBLIC_A')
    write('components/Bar.tsx', 'process.env.NEXT_PUBLIC_B')
    expect(findViolations(dir)).toHaveLength(2)
  })

  it('tests 는 검사하지 않는다 — 번들되지 않고 픽스처로 쓴다', () => {
    write('tests/x.test.ts', 'NEXT_PUBLIC_FIXTURE')
    expect(findViolations(dir)).toEqual([])
  })

  it('scripts 는 검사하지 않는다 — 번들되지 않는다', () => {
    write('scripts/y.mjs', 'NEXT_PUBLIC_FIXTURE')
    expect(findViolations(dir)).toEqual([])
  })

  it('node_modules 는 검사하지 않는다', () => {
    write('node_modules/pkg/c.ts', 'NEXT_PUBLIC_X')
    expect(findViolations(dir)).toEqual([])
  })

  it('검사 대상이 아닌 확장자는 건너뛴다', () => {
    write('lib/notes.txt', 'NEXT_PUBLIC_X')
    write('lib/data.json', 'NEXT_PUBLIC_X')
    expect(findViolations(dir)).toEqual([])
  })
})
