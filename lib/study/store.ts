import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm'
import {
  studyMaterials, studyMessages, studyProblems, studySessions, studySubmissions,
} from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import type { FeedbackMode, StudyMode } from './modes'
import {
  StoredMaterialContent, publicFeedback, publicProblem, splitProblem,
  type MaterialGenT, type PublicFeedback, type PublicProblem,
} from './schemas'

/**
 * 자유학습의 DB 함수.
 *
 * ★ 세션 경계를 여기서 강제한다. 문제를 찾는 함수는 전부 sessionId 를 받고
 * 그 세션의 행이 아니면 null 을 준다. 위 계층이 실수로 다른 세션의 problemId 를
 * 넘겨도 그 문제의 비공개부가 문맥에 섞이지 않는다.
 *
 * neon-http 드라이버는 트랜잭션이 없다. 순서와 UNIQUE 제약으로 버틴다.
 */

export type MessageRole = 'user' | 'assistant'
export type MessageKind = 'chat' | 'material' | 'feedback' | 'notice'

export type ProblemRow = typeof studyProblems.$inferSelect
export type SessionRow = typeof studySessions.$inferSelect

export interface SessionSummary {
  id: number
  mode: StudyMode
  title: string
  updatedAt: Date
}

export async function createSession(
  db: Db, clock: Clock, i: { mode: StudyMode; request: string; title: string },
): Promise<number> {
  const now = clock.now()
  const [row] = await db.insert(studySessions).values({
    studyMode: i.mode, request: i.request, title: i.title, createdAt: now, updatedAt: now,
  }).returning({ id: studySessions.id })
  return row.id
}

export async function getSession(db: Db, id: number): Promise<SessionRow | null> {
  const [row] = await db.select().from(studySessions).where(eq(studySessions.id, id))
  return row ?? null
}

export async function listRecentSessions(db: Db, limit = 12): Promise<SessionSummary[]> {
  const rows = await db.select({
    id: studySessions.id, mode: studySessions.studyMode,
    title: studySessions.title, updatedAt: studySessions.updatedAt,
  }).from(studySessions)
    .orderBy(desc(studySessions.updatedAt), desc(studySessions.id))
    .limit(limit)
  return rows.map((r) => ({ ...r, mode: r.mode as StudyMode }))
}

export async function touchSession(db: Db, clock: Clock, sessionId: number): Promise<void> {
  await db.update(studySessions).set({ updatedAt: clock.now() }).where(eq(studySessions.id, sessionId))
}

const SUMMARY_CHARS = 1_200

/**
 * 모델이 준 한두 문장을 요약 끝에 붙인다. 오래된 앞부분부터 잘라 길이를 묶는다 —
 * 긴 대화 전체를 매번 보내지 않기 위한 장치이므로 이것도 무한히 자라면 안 된다.
 */
export async function appendSessionNote(
  db: Db, clock: Clock, sessionId: number, note: string,
): Promise<void> {
  const trimmed = note.trim()
  if (!trimmed) return touchSession(db, clock, sessionId)
  const s = await getSession(db, sessionId)
  if (!s) return
  const next = (s.summary ? `${s.summary}\n${trimmed}` : trimmed).slice(-SUMMARY_CHARS)
  await db.update(studySessions)
    .set({ summary: next, updatedAt: clock.now() })
    .where(eq(studySessions.id, sessionId))
}

export async function appendMessage(db: Db, clock: Clock, m: {
  sessionId: number; role: MessageRole; kind: MessageKind; bodyMd: string
  requestId?: string; materialId?: number | null; problemId?: number | null
}): Promise<number> {
  const [row] = await db.insert(studyMessages).values({
    sessionId: m.sessionId, role: m.role, kind: m.kind, bodyMd: m.bodyMd,
    requestId: m.requestId ?? null, materialId: m.materialId ?? null,
    problemId: m.problemId ?? null, createdAt: clock.now(),
  }).returning({ id: studyMessages.id })
  await touchSession(db, clock, m.sessionId)
  return row.id
}

/**
 * 자료 한 버전과 그 문제들을 넣는다. 이전 버전은 건드리지 않는다.
 *
 * 버전·번호는 「지금 최댓값 + 1」이다. 같은 세션에서 두 요청이 겹치면 UNIQUE 가
 * 하나를 거절하므로 다시 읽어 몇 번 더 시도한다.
 */
export async function insertMaterial(db: Db, clock: Clock, i: {
  sessionId: number; parentId: number | null; requestId: string; gen: MaterialGenT
}): Promise<{ materialId: number; version: number; problemIds: number[] }> {
  const content = { title: i.gen.title, blocks: i.gen.blocks }

  let materialId = 0
  let version = 0
  for (let attempt = 0; ; attempt++) {
    const [{ v }] = await db.select({ v: max(studyMaterials.version) })
      .from(studyMaterials).where(eq(studyMaterials.sessionId, i.sessionId))
    version = (v ?? 0) + 1
    const rows = await db.insert(studyMaterials).values({
      sessionId: i.sessionId, version, parentId: i.parentId, activity: i.gen.activity,
      content, requestId: i.requestId, createdAt: clock.now(),
    }).onConflictDoNothing().returning({ id: studyMaterials.id })
    if (rows.length > 0) { materialId = rows[0].id; break }
    if (attempt >= 4) throw new Error('자료 버전을 잡지 못했다')
  }

  let problemIds: number[] = []
  if (i.gen.problems.length > 0) {
    for (let attempt = 0; ; attempt++) {
      const [{ n }] = await db.select({ n: max(studyProblems.number) })
        .from(studyProblems).where(eq(studyProblems.sessionId, i.sessionId))
      const base = n ?? 0
      try {
        const rows = await db.insert(studyProblems).values(i.gen.problems.map((p, k) => {
          const { pub, priv } = splitProblem(p)
          return {
            sessionId: i.sessionId, materialId, number: base + k + 1,
            public: pub, private: priv, createdAt: clock.now(),
          }
        })).returning({ id: studyProblems.id })
        problemIds = rows.map((r) => r.id)
        break
      } catch (e) {
        if (attempt >= 4) throw e
      }
    }
  }

  await touchSession(db, clock, i.sessionId)
  return { materialId, version, problemIds }
}

export async function latestMaterialId(db: Db, sessionId: number): Promise<number | null> {
  const [row] = await db.select({ id: studyMaterials.id }).from(studyMaterials)
    .where(eq(studyMaterials.sessionId, sessionId))
    .orderBy(desc(studyMaterials.version)).limit(1)
  return row?.id ?? null
}

/** 세션의 문제만 찾는다. 다른 세션의 ID 면 null */
export async function findProblem(db: Db, sessionId: number, problemId: number): Promise<ProblemRow | null> {
  const [row] = await db.select().from(studyProblems)
    .where(and(eq(studyProblems.id, problemId), eq(studyProblems.sessionId, sessionId)))
  return row ?? null
}

export async function findProblemByNumber(db: Db, sessionId: number, n: number): Promise<ProblemRow | null> {
  const [row] = await db.select().from(studyProblems)
    .where(and(eq(studyProblems.sessionId, sessionId), eq(studyProblems.number, n)))
  return row ?? null
}

export async function problemsOfMaterial(db: Db, materialId: number): Promise<ProblemRow[]> {
  return db.select().from(studyProblems)
    .where(eq(studyProblems.materialId, materialId)).orderBy(asc(studyProblems.number))
}

/** 힌트·해설 라우트가 세션을 모른 채 문제 ID 만 받는다. 그 문제가 어느 세션 것인지 */
export async function problemSession(db: Db, problemId: number): Promise<number | null> {
  const [row] = await db.select({ s: studyProblems.sessionId }).from(studyProblems)
    .where(eq(studyProblems.id, problemId))
  return row?.s ?? null
}

/** 다음 힌트를 연다. 원자적 UPDATE 한 문장 — 연타해도 3 을 넘지 않는다 */
export async function revealNextHint(db: Db, problemId: number): Promise<number> {
  const [row] = await db.update(studyProblems)
    .set({ hintsRevealed: sql`LEAST(${studyProblems.hintsRevealed} + 1, 3)` })
    .where(eq(studyProblems.id, problemId))
    .returning({ n: studyProblems.hintsRevealed })
  return row?.n ?? 0
}

export async function revealSolution(db: Db, problemId: number): Promise<void> {
  await db.update(studyProblems).set({ solutionRevealed: true }).where(eq(studyProblems.id, problemId))
}

/** 시도 번호는 「지금 최댓값 + 1」. UNIQUE 충돌이면 다시 읽어 시도한다 */
export async function insertSubmission(db: Db, clock: Clock, i: {
  problemId: number; answer: string; language: string | null; feedbackMode: FeedbackMode
  feedback: object; verdict: string; requestId: string
}): Promise<{ id: number; attemptNo: number }> {
  for (let attempt = 0; ; attempt++) {
    const [{ n }] = await db.select({ n: max(studySubmissions.attemptNo) })
      .from(studySubmissions).where(eq(studySubmissions.problemId, i.problemId))
    const attemptNo = (n ?? 0) + 1
    const rows = await db.insert(studySubmissions).values({
      problemId: i.problemId, attemptNo, answer: i.answer, language: i.language,
      feedbackMode: i.feedbackMode, feedback: i.feedback, verdict: i.verdict,
      requestId: i.requestId, createdAt: clock.now(),
    }).onConflictDoNothing().returning({ id: studySubmissions.id })
    if (rows.length > 0) return { id: rows[0].id, attemptNo }
    if (attempt >= 4) throw new Error('제출 번호를 잡지 못했다')
  }
}

export async function submissionCount(db: Db, problemId: number): Promise<number> {
  const [{ n }] = await db.select({ n: max(studySubmissions.attemptNo) })
    .from(studySubmissions).where(eq(studySubmissions.problemId, problemId))
  return n ?? 0
}

export async function recentSubmissions(db: Db, problemId: number, n = 2) {
  return db.select().from(studySubmissions)
    .where(eq(studySubmissions.problemId, problemId))
    .orderBy(desc(studySubmissions.attemptNo)).limit(n)
}

export async function recentMessages(db: Db, sessionId: number, n: number) {
  const rows = await db.select().from(studyMessages)
    .where(eq(studyMessages.sessionId, sessionId))
    .orderBy(desc(studyMessages.id)).limit(n)
  return rows.reverse()
}

// ── 화면 데이터 ───────────────────────────────────

export interface PublicMessage {
  id: number
  role: MessageRole
  kind: MessageKind
  bodyMd: string
  materialId: number | null
  problemId: number | null
  createdAt: string
}

export interface PublicMaterial {
  id: number
  version: number
  activity: string
  title: string
  blocks: Array<{ kind: string; title: string; body_md: string }>
  problems: PublicProblem[]
}

export interface PublicSubmission {
  id: number
  attemptNo: number
  answer: string
  language: string | null
  feedbackMode: string
  verdict: string
  feedback: PublicFeedback
  createdAt: string
}

export interface SessionView {
  session: { id: number; mode: StudyMode; title: string; request: string; createdAt: string }
  messages: PublicMessage[]
  materials: PublicMaterial[]
  submissions: Record<number, PublicSubmission[]>
}

/**
 * 학습 화면이 그리는 전부. **공개해도 되는 것만** 담는다.
 *
 * 서버 컴포넌트가 이 결과를 클라이언트 컴포넌트에 넘기므로, 여기 담긴 것은
 * 곧 초기 HTML 과 클라이언트 상태다. 문제는 `publicProblem` 을 지나서만 들어간다.
 */
export async function loadSessionView(db: Db, sessionId: number): Promise<SessionView | null> {
  const session = await getSession(db, sessionId)
  if (!session) return null

  const messages = await db.select().from(studyMessages)
    .where(eq(studyMessages.sessionId, sessionId)).orderBy(asc(studyMessages.id))
  const materials = await db.select().from(studyMaterials)
    .where(eq(studyMaterials.sessionId, sessionId)).orderBy(asc(studyMaterials.version))
  const problems = await db.select().from(studyProblems)
    .where(eq(studyProblems.sessionId, sessionId)).orderBy(asc(studyProblems.number))
  const subs = problems.length === 0 ? [] : await db.select().from(studySubmissions)
    .where(inArray(studySubmissions.problemId, problems.map((p) => p.id)))
    .orderBy(asc(studySubmissions.attemptNo))

  const submissions: Record<number, PublicSubmission[]> = {}
  for (const s of subs) {
    ;(submissions[s.problemId] ??= []).push({
      id: s.id, attemptNo: s.attemptNo, answer: s.answer, language: s.language,
      feedbackMode: s.feedbackMode, verdict: s.verdict,
      feedback: publicFeedback(s.feedback),
      createdAt: s.createdAt.toISOString(),
    })
  }

  return {
    session: {
      id: session.id, mode: session.studyMode as StudyMode, title: session.title,
      request: session.request, createdAt: session.createdAt.toISOString(),
    },
    messages: messages.map((m) => ({
      id: m.id, role: m.role as MessageRole, kind: m.kind as MessageKind, bodyMd: m.bodyMd,
      materialId: m.materialId, problemId: m.problemId, createdAt: m.createdAt.toISOString(),
    })),
    materials: materials.map((m) => {
      // 저장 스키마로 읽는다. 옛 형식이어도 화면이 막히지 않는다.
      const c = StoredMaterialContent.safeParse(m.content)
      const content = c.success ? c.data : { title: '(읽을 수 없는 자료)', blocks: [] }
      return {
        id: m.id, version: m.version, activity: m.activity, title: content.title,
        blocks: content.blocks.map((b) => ({ kind: b.kind, title: b.title, body_md: b.body_md })),
        problems: problems.filter((p) => p.materialId === m.id).map(publicProblem),
      }
    }),
    submissions,
  }
}
