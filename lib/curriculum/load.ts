import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { CurriculumSchema, SUBJECTS, type Curriculum, type DayEntry, type Subject } from './schema'

// 소비자가 './load' 하나만 import 하면 되게 다시 내보낸다
export type { Subject, DayEntry, Curriculum } from './schema'
export { SUBJECTS } from './schema'

const cache = new Map<Subject, Curriculum>()

/**
 * 커리큘럼은 DB가 아니라 레포의 YAML 파일이다.
 * PR로 고치고, 리뷰가 남고, 롤백되고, 프로덕션 DB를 건드릴 일이 없다.
 * 형식 위반은 테스트에서 잡혀 배포가 막힌다.
 */
export function loadCurriculum(subject: Subject): Curriculum {
  const cached = cache.get(subject)
  if (cached) return cached

  const path = join(process.cwd(), 'curriculum', `${subject}.yaml`)
  const parsed = CurriculumSchema.parse(parse(readFileSync(path, 'utf8')))

  if (parsed.subject !== subject) {
    throw new Error(`${path} 의 subject 가 '${parsed.subject}' 입니다. 파일명과 일치해야 합니다`)
  }

  cache.set(subject, parsed)
  return parsed
}

export function getDay(subject: Subject, dayNo: number): DayEntry | null {
  return loadCurriculum(subject).days.find((d) => d.day === dayNo) ?? null
}

export function loadAll(): Record<Subject, Curriculum> {
  return Object.fromEntries(
    SUBJECTS.map((s) => [s, loadCurriculum(s)]),
  ) as Record<Subject, Curriculum>
}
