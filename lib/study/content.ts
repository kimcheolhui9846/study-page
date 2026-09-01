import { and, eq } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import { kstToday, type Clock } from '../time'
import { getDay, loadCurriculum, type Subject } from '../curriculum/load'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import type { LlmClient } from '../llm/types'
import { CONTENT_JSON_SCHEMA, ContentSchema } from '../llm/schemas'
import { CONTENT_SYSTEM, contentUserMessage } from '../llm/prompts'
import { MODEL } from '../llm/pricing'

export interface ContentDeps {
  db: Db
  clock: Clock
  llm: LlmClient
}

/** 클라이언트에 나가는 형태. 루브릭과 힌트가 없다. */
export interface PublicContent {
  passage: unknown
  questions: Array<{ id: string; type: string; prompt: string }>
}

export type ContentOutcome =
  | { status: 'ok'; content: PublicContent }
  | { status: 'no_such_day' }
  | { status: 'already_studied_today' }
  | { status: 'cap_exceeded' }

interface RawQuestion {
  id: string
  type: string
  prompt: string
  expected_points?: string[]
  hint?: string
}

/**
 * 루브릭과 힌트를 벗긴다.
 *
 * 허용 목록으로 뽑는다 — 삭제 방식이면 나중에 새 비밀 필드가 생겼을 때
 * 조용히 새어 나간다. 여기서는 id, type, prompt 세 개만 통과한다.
 */
function toPublic(raw: unknown): PublicContent {
  const c = raw as { passage: unknown; questions?: RawQuestion[] }
  return {
    passage: c.passage,
    questions: (c.questions ?? []).map((q) => ({ id: q.id, type: q.type, prompt: q.prompt })),
  }
}

/**
 * 오늘의 학습 콘텐츠를 준다. 없으면 만든다.
 *
 * 4겹 방어 중 ②③겹이 여기 있다. ①겹(세션)은 라우트의 withSession 가드가,
 * ④겹(OpenAI 하드 리밋)은 코드 밖에서 담당한다.
 *
 * 순서가 중요하다 — 싼 검사가 먼저 온다:
 *   커리큘럼 확인 → 캐시 → 당일 중복 → 예산 예약 → LLM 호출
 * 예산 예약이 LLM 호출보다 먼저이므로, 캡에 걸리면 호출 자체가 일어나지 않는다.
 */
export async function getOrCreateContent(
  deps: ContentDeps, subject: Subject, dayNo: number,
): Promise<ContentOutcome> {
  const { db, clock, llm } = deps

  const entry = getDay(subject, dayNo)
  if (!entry) return { status: 'no_such_day' }

  // ②겹 — 이미 만든 Day 면 LLM 을 부르지 않는다. 대부분의 요청이 여기서 끝난다.
  const existing = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, dayNo)))
  if (existing[0]) return { status: 'ok', content: toPublic(existing[0].content) }

  // ②겹 — 이 과목을 오늘 이미 했으면 새 Day 를 열지 않는다
  const today = kstToday(clock.now())
  const todays = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.studyDate, today)))
  if (todays[0]) return { status: 'already_studied_today' }

  // ③겹 — 예산을 먼저 확보한다. 실패하면 LLM 을 부르지 않는다.
  const reservation = await reserve(db, clock)
  if (!reservation) return { status: 'cap_exceeded' }

  let result
  try {
    result = await llm.generate<unknown>({
      route: 'content',
      system: CONTENT_SYSTEM,
      user: contentUserMessage(loadCurriculum(subject).label, entry),
      schemaName: 'study_content',
      jsonSchema: CONTENT_JSON_SCHEMA,
      maxTokens: 2000,
      temperature: 0.6,
    })

    // Structured Outputs 가 형식을 보장하지만 우리 쪽에서도 본다.
    // ★ 여기서 통과한 것만 DB 에 들어간다 — 한 번 들어가면 UNIQUE 제약 때문에
    // 그 Day 는 평생 그 내용이다. 반쪽짜리를 저장하면 되살릴 방법이 없다.
    const parsed = ContentSchema.safeParse(result.data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(
        `콘텐츠 형식이 스키마와 다릅니다: ${issue?.path.join('.')} — ${issue?.message}`,
      )
    }
    result = { ...result, data: parsed.data }
  } catch (err) {
    await rollback(db, reservation)
    await recordUsage(db, clock, {
      route: 'content', subject, model: MODEL,
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    throw err
  }

  await recordUsage(db, clock, {
    route: 'content', subject, model: MODEL,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
    ok: true,
  })

  // 루브릭을 포함한 원본을 저장한다. 채점이 이걸 쓴다.
  // ON CONFLICT 로 동시 요청이 둘 다 여기까지 와도 한 쪽만 살린다.
  await db.insert(studyDays)
    .values({ subject, dayNo, studyDate: today, content: result.data as object })
    .onConflictDoNothing()

  return { status: 'ok', content: toPublic(result.data) }
}
