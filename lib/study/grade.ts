import { and, eq, sql } from 'drizzle-orm'
import { attempts, studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import { getDay, type Subject } from '../curriculum/load'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import { GRADE_JSON_SCHEMA, GradeSchema, type GeneratedContent, type GradeResult } from '../llm/schemas'
import { GRADE_SYSTEM, gradeUserMessage } from '../llm/prompts'
import { MODEL } from '../llm/pricing'
import type { LlmClient } from '../llm/types'

export interface GradeDeps {
  db: Db
  clock: Clock
  llm: LlmClient
}

export type GradeOutcome =
  | { status: 'ok'; attemptNo: number; feedback: GradeResult }
  | { status: 'no_such_day' }
  | { status: 'empty_answers' }
  | { status: 'attempt_cap' }
  | { status: 'cap_exceeded' }

/** Postgres 제약 위반 코드. PGlite 와 Neon 이 같은 값을 준다. */
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

/**
 * Postgres 오류 코드를 꺼낸다.
 *
 * drizzle 은 드라이버 오류를 DrizzleQueryError 로 감싸므로 code 가 최상위에
 * 없다. cause 사슬을 따라가야 한다. 이걸 모르고 최상위만 보면 CHECK 위반을
 * 못 알아보고 그대로 던져버린다 — 상한 도달이 500 이 된다.
 */
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e
  for (let depth = 0; cur && depth < 5; depth++) {
    const node = cur as { code?: unknown; cause?: unknown }
    if (typeof node.code === 'string') return node.code
    cur = node.cause
  }
  return undefined
}

/**
 * 채점 슬롯을 잡는다. 번호는 DB 가 정한다.
 *
 * `attempts` 의 CHECK(attempt_no BETWEEN 1 AND 2)가 3번째 INSERT 를 거부한다 —
 * 상한을 애플리케이션 조건문이 아니라 제약이 강제한다.
 *
 * 번호를 서브쿼리로 계산해 한 문장 안에서 끝낸다. 읽고-계산하고-쓰기로
 * 나누면 그 사이에 다른 요청이 같은 번호를 가져갈 수 있다. 그래도 동시에
 * 두 요청이 같은 번호를 잡으면 UNIQUE 가 하나를 튕기므로, 그때는 한 번
 * 더 시도한다 (그 사이 MAX 가 올라갔으니 다음 번호를 잡는다).
 */
async function reserveAttempt(
  db: Db, studyDayId: number, answers: Record<string, string>,
): Promise<number | null> {
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    try {
      const [row] = await db.insert(attempts).values({
        studyDayId,
        attemptNo: sql`(SELECT COALESCE(MAX(attempt_no), 0) + 1
                          FROM attempts WHERE study_day_id = ${studyDayId})`,
        answers,
      }).returning({ attemptNo: attempts.attemptNo })
      return row.attemptNo
    } catch (e) {
      if (pgCode(e) === CHECK_VIOLATION) return null // 상한 도달
      if (pgCode(e) === UNIQUE_VIOLATION) continue // 경쟁 — 다시
      throw e
    }
  }
  return null
}

async function releaseAttempt(db: Db, studyDayId: number, attemptNo: number): Promise<void> {
  await db.delete(attempts)
    .where(and(eq(attempts.studyDayId, studyDayId), eq(attempts.attemptNo, attemptNo)))
}

/**
 * 답안을 채점한다.
 *
 * 순서가 곧 방어선이다:
 *   Day 확인 → 빈 답안 거르기 → 채점 슬롯 → 예산 → LLM
 *
 * 채점 슬롯이 예산보다 먼저다. 더 좁은 제약이 먼저 걸러야 쓸데없이 예산을
 * 건드리지 않는다. 반대로 예산에서 막히면 잡아둔 슬롯을 되돌린다 —
 * 호출도 못 했는데 재시도 기회를 잃으면 안 된다.
 */
export async function gradeAnswers(
  deps: GradeDeps, subject: Subject, dayNo: number, answers: Record<string, string>,
): Promise<GradeOutcome> {
  const { db, clock, llm } = deps

  const entry = getDay(subject, dayNo)
  if (!entry) return { status: 'no_such_day' }

  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, dayNo)))
  if (!day) return { status: 'no_such_day' }

  // 전부 공백인 제출로 LLM 을 부르는 것은 순수한 낭비다.
  // 화면의 disabled 에 의존하지 않는다 — curl 로도 막혀야 한다.
  const hasAnswer = Object.values(answers).some((a) => typeof a === 'string' && a.trim() !== '')
  if (!hasAnswer) return { status: 'empty_answers' }

  const attemptNo = await reserveAttempt(db, day.id, answers)
  if (attemptNo === null) return { status: 'attempt_cap' }

  const reservation = await reserve(db, clock)
  if (!reservation) {
    await releaseAttempt(db, day.id, attemptNo)
    return { status: 'cap_exceeded' }
  }

  const questions = (day.content as { questions: GeneratedContent['questions'] }).questions

  let feedback: GradeResult
  let result
  try {
    result = await llm.generate<unknown>({
      route: 'grade',
      system: GRADE_SYSTEM,
      user: gradeUserMessage(entry, questions, answers),
      schemaName: 'grade_result',
      jsonSchema: GRADE_JSON_SCHEMA,
      maxTokens: 1500,
      // ★ 0 이어야 한다. 같은 답안에 같은 점수가 나와야 채점을 신뢰할 수 있다.
      temperature: 0,
    })

    const parsed = GradeSchema.safeParse(result.data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(
        `채점 결과가 스키마와 다릅니다: ${issue?.path.join('.')} — ${issue?.message}`,
      )
    }
    feedback = parsed.data
  } catch (err) {
    await releaseAttempt(db, day.id, attemptNo)
    await rollback(db, reservation)
    await recordUsage(db, clock, {
      route: 'grade', subject, model: MODEL,
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    throw err
  }

  await recordUsage(db, clock, {
    route: 'grade', subject, model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
    ok: true,
  })

  await db.update(attempts).set({ feedback })
    .where(and(eq(attempts.studyDayId, day.id), eq(attempts.attemptNo, attemptNo)))

  return { status: 'ok', attemptNo, feedback }
}
