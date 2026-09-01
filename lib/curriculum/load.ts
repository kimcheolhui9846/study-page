import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { DomainFileSchema, LinksFileSchema, SUBJECTS, type DomainFile, type Link } from './schema'
import { buildGraph, CurriculumError, type CurriculumGraph } from './graph'

export * from './schema'
export * from './graph'

/**
 * 커리큘럼은 DB 가 아니라 레포의 파일이다.
 * PR 로 고치고, 리뷰가 남고, 롤백되고, 프로덕션 DB 를 건드릴 일이 없다.
 *
 * 그래프는 한 번 만들고 캐시한다. 검증이 여기서 한 번만 돌면 되고,
 * 깨진 커리큘럼이면 첫 요청에서 크게 실패한다.
 */
let cached: CurriculumGraph | null = null

const ROOT = () => join(process.cwd(), 'curriculum')

function readDomainFiles(): DomainFile[] {
  const files: DomainFile[] = []

  for (const subject of SUBJECTS) {
    const dir = join(ROOT(), subject)
    if (!existsSync(dir)) continue

    for (const name of readdirSync(dir).sort()) {
      // '_' 로 시작하는 파일은 Topic 을 담지 않는다 (설명·메모용)
      if (name.startsWith('_') || !name.endsWith('.yaml')) continue

      const path = join(dir, name)
      const parsed = DomainFileSchema.safeParse(parse(readFileSync(path, 'utf8')))
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new CurriculumError(
          `${subject}/${name} 형식 오류: ${issue?.path.join('.')} — ${issue?.message}`,
        )
      }
      if (parsed.data.subject !== subject) {
        throw new CurriculumError(
          `${subject}/${name} 의 subject 가 '${parsed.data.subject}' 입니다. 폴더명과 일치해야 합니다`,
        )
      }
      files.push(parsed.data)
    }
  }

  if (files.length === 0) throw new CurriculumError('커리큘럼 파일이 하나도 없습니다')
  return files
}

function readLinks(): Link[] {
  const path = join(ROOT(), '_links.yaml')
  if (!existsSync(path)) return []

  const parsed = LinksFileSchema.safeParse(parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CurriculumError(`_links.yaml 형식 오류: ${issue?.path.join('.')} — ${issue?.message}`)
  }
  return parsed.data.links
}

export function loadGraph(): CurriculumGraph {
  cached ??= buildGraph(readDomainFiles(), readLinks())
  return cached
}

/** 테스트가 파일을 바꾼 뒤 다시 읽게 한다. 프로덕션에서는 부르지 않는다. */
export function resetGraphCache(): void {
  cached = null
}
