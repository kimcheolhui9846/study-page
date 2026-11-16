import type { Db } from '../db/types'
import type { FeedbackMode, StudyMode } from './modes'
import {
  StoredFeedback, StoredMaterialContent, StoredProblemPrivate, StoredProblemPublic,
  publicProblem, type PublicProblem,
} from './schemas'
import {
  findProblem, findProblemByNumber, getSession, latestMaterialId,
  problemsOfMaterial, recentMessages, recentSubmissions,
} from './store'
import { studyMaterials, studyProblems } from '../db/schema'
import { eq, max } from 'drizzle-orm'

/**
 * 모델이 보는 것을 고른다. 모델은 DB 를 모르고 이 함수들이 고른 것만 본다.
 *
 * ★ 모델마다 볼 수 있는 것이 다르다 (스펙 §4 표).
 *   - 대화(luna)  — 공개부만. 학습자가 열지 않은 해설은 **넘기지 않는다**
 *                   → 대화로도 새지 않는다
 *   - 자료(terra) — 공개부만. 새 문제를 만드는 데 정답은 필요 없다
 *   - 피드백(terra) — 그 문제 하나의 비공개부(정답·루브릭·해설)
 *
 * 모든 조회는 sessionId 로 묶인다. 다른 세션의 행은 들어오지 않는다.
 */

export const RECENT_MESSAGES = 8
export const MESSAGE_CHARS = 1_500
const BLOCK_CHARS = 2_500
const ANSWER_CHARS = 12_000

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/**
 * 「2번 문제」「문제 3」「12번」 → 번호. 없으면 null.
 * 연도 같은 큰 수(「2024년」)는 번호가 아니다 — 「번」이나 「문제」가 붙어야 한다.
 */
export function resolveProblemNumber(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*번/) ?? text.match(/문제\s*(\d{1,3})/)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

export interface RecentMessage { role: string; kind: string; body: string }

export interface MaterialSnapshot {
  version: number
  title: string
  blocks: Array<{ kind: string; title: string; body_md: string }>
  problems: PublicProblem[]
}

interface Base {
  mode: StudyMode
  request: string
  summary: string
}

export interface ChatContext extends Base {
  text: string
  recent: RecentMessage[]
  material: MaterialSnapshot | null
  /** 학습자가 가리킨 문제. 공개된 힌트·해설만 */
  focus: PublicProblem | null
}

export interface MaterialContext extends Base {
  instruction: string
  recent: RecentMessage[]
  material: MaterialSnapshot | null
  /** 새 문제가 받을 첫 번호. 모델이 「4번부터」라고 말할 수 있게 */
  nextNumber: number
}

export interface FeedbackContext extends Base {
  problem: {
    number: number
    prompt_md: string
    kind: string
    spec: PublicProblem['spec']
    answer_md: string
    rubric: string[]
    solution_md: string
  }
  previous: Array<{ attemptNo: number; answer: string; verdict: string; summary: string }>
  answer: string
  language: string | null
  feedbackMode: FeedbackMode
}

async function base(db: Db, sessionId: number): Promise<Base | null> {
  const s = await getSession(db, sessionId)
  if (!s) return null
  return { mode: s.studyMode as StudyMode, request: s.request, summary: s.summary }
}

async function recent(db: Db, sessionId: number): Promise<RecentMessage[]> {
  return (await recentMessages(db, sessionId, RECENT_MESSAGES)).map((m) => ({
    role: m.role, kind: m.kind, body: clip(m.bodyMd, MESSAGE_CHARS),
  }))
}

async function latestMaterial(db: Db, sessionId: number): Promise<MaterialSnapshot | null> {
  const id = await latestMaterialId(db, sessionId)
  if (id === null) return null
  const [row] = await db.select().from(studyMaterials).where(eq(studyMaterials.id, id))
  const c = StoredMaterialContent.safeParse(row.content)
  const content = c.success ? c.data : { title: '', blocks: [] }
  return {
    version: row.version,
    title: content.title,
    blocks: content.blocks.map((b) => ({ kind: b.kind, title: b.title, body_md: clip(b.body_md, BLOCK_CHARS) })),
    problems: (await problemsOfMaterial(db, id)).map(publicProblem),
  }
}

export async function buildChatContext(
  db: Db, sessionId: number, i: { text: string; problemId?: number },
): Promise<ChatContext | null> {
  const b = await base(db, sessionId)
  if (!b) return null

  // 화면이 고른 문제가 먼저다. 그 ID 가 이 세션 것이 아니면 무시하고 본문의 번호로.
  let row = i.problemId ? await findProblem(db, sessionId, i.problemId) : null
  if (!row) {
    const n = resolveProblemNumber(i.text)
    if (n !== null) row = await findProblemByNumber(db, sessionId, n)
  }

  return {
    ...b,
    text: i.text,
    recent: await recent(db, sessionId),
    material: await latestMaterial(db, sessionId),
    focus: row ? publicProblem(row) : null,
  }
}

export async function buildMaterialContext(
  db: Db, sessionId: number, instruction: string,
): Promise<MaterialContext | null> {
  const b = await base(db, sessionId)
  if (!b) return null
  const material = await latestMaterial(db, sessionId)
  const [{ n }] = await db.select({ n: max(studyProblems.number) })
    .from(studyProblems).where(eq(studyProblems.sessionId, sessionId))
  return {
    ...b, instruction, recent: await recent(db, sessionId), material, nextNumber: (n ?? 0) + 1,
  }
}

export async function buildFeedbackContext(
  db: Db, sessionId: number, problemId: number,
  answer: string, language: string | null, feedbackMode: FeedbackMode,
): Promise<FeedbackContext | null> {
  const b = await base(db, sessionId)
  if (!b) return null
  const row = await findProblem(db, sessionId, problemId)
  if (!row) return null

  const pub = publicProblem(row)
  const priv = StoredProblemPrivate.parse(row.private)
  const rawPub = StoredProblemPublic.parse(row.public)

  const previous = (await recentSubmissions(db, problemId, 2)).reverse().map((s) => ({
    attemptNo: s.attemptNo,
    answer: clip(s.answer, 3_000),
    verdict: s.verdict,
    summary: StoredFeedback.parse(s.feedback).summary_md,
  }))

  return {
    ...b,
    problem: {
      number: row.number, prompt_md: rawPub.prompt_md, kind: rawPub.kind, spec: pub.spec,
      answer_md: priv.answer_md, rubric: priv.rubric, solution_md: priv.solution_md,
    },
    previous,
    answer: clip(answer, ANSWER_CHARS),
    language,
    feedbackMode,
  }
}
