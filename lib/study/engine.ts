import { reconcilePoints } from '../llm/grade'
import { CHAT_MODEL, WORK_MODEL } from '../llm/pricing'
import { paidCall, type CallFailure, type StudyDeps } from './call'
import {
  buildChatContext, buildFeedbackContext, buildMaterialContext,
} from './context'
import { getMode, type FeedbackMode, type ModeHarness, type StudyMode } from './modes'
import {
  chatSystem, chatUser, feedbackSystem, feedbackUser,
  materialSystem, materialUser, startSystem, startUser,
} from './prompts'
import { claimRequest, failRequest, finishRequest } from './requests'
import {
  ChatGen, FeedbackGen, MaterialGen, StartGen, StoredProblemPrivate,
  chatJsonSchema, feedbackJsonSchema, materialJsonSchema, startJsonSchema,
  type MaterialGenT,
} from './schemas'
import {
  appendMessage, appendSessionNote, createSession, findProblem, findProblemByNumber,
  getSession, insertMaterial, insertSubmission, latestMaterialId, problemSession,
  revealNextHint, revealSolution, submissionCount,
} from './store'

/**
 * 자유학습의 행동. 라우트는 이 함수를 부르고 결과를 HTTP 로 옮길 뿐이다.
 *
 * 호출 수 (스펙 §4):
 *   start   terra 1
 *   message luna 1 (+ 의도가 자료면 terra 1)
 *   more    terra 1
 *   submit  terra 1
 *   hint · reveal  0
 *
 * 유료 행동은 전부 requestId 로 멱등하다 (lib/study/requests.ts).
 */

export type EngineError =
  | CallFailure
  | 'IN_PROGRESS'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'REQUEST_MISMATCH'
  | 'NO_MORE_HINTS'
  | 'ATTEMPT_LIMIT'

export type EngineResult<T> =
  | { ok: true; value: T; replayed: boolean }
  | { ok: false; code: EngineError; message: string }

const MESSAGES: Record<EngineError, string> = {
  BUDGET_EXCEEDED: 'AI 사용 한도를 다 썼다. 작성한 내용은 그대로 남아 있다.',
  GENERATION_FAILED: 'AI 응답을 받지 못했다. 잠시 뒤 다시 시도하라.',
  INVALID_OUTPUT: 'AI 응답이 형식에 맞지 않아 저장하지 않았다. 다시 시도하라.',
  IN_PROGRESS: '같은 요청을 처리하는 중이다.',
  NOT_FOUND: '학습이나 문제를 찾을 수 없다.',
  INVALID_INPUT: '입력이 올바르지 않다.',
  REQUEST_MISMATCH: '요청 식별자가 다른 요청에 이미 쓰였다.',
  NO_MORE_HINTS: '힌트를 모두 열었다.',
  ATTEMPT_LIMIT: '이 문제의 제출 횟수(20회)를 다 썼다.',
}

/** 문제당 제출 상한. study_submissions 의 CHECK 와 같은 값이다 */
const MAX_ATTEMPTS = 20

const fail = <T>(code: EngineError): EngineResult<T> => ({ ok: false, code, message: MESSAGES[code] })
const done = <T>(value: T, replayed = false): EngineResult<T> => ({ ok: true, value, replayed })

/** 출력 상한. 추론 토큰까지 포함한다 (스펙 §6) */
const WORK = { model: WORK_MODEL, reasoningEffort: 'low' as const, maxTokens: 12_000 }
const CHAT = { model: CHAT_MODEL, reasoningEffort: 'low' as const, maxTokens: 4_000 }

/**
 * 멱등성 포장. 처음 보는 요청만 body 를 실행한다.
 * body 가 실패를 돌려주면 그 코드를 요청에 남긴다 — 같은 ID 로는 다시 하지 않는다.
 */
async function once<T>(
  deps: StudyDeps,
  i: { requestId: string; action: string; sessionId: number | null },
  body: () => Promise<EngineResult<T>>,
): Promise<EngineResult<T>> {
  const claim = await claimRequest(deps.db, deps.clock, i)
  switch (claim.kind) {
    case 'done': return done(claim.result as T, true)
    case 'failed': return fail(claim.errorCode as EngineError)
    case 'pending': return fail('IN_PROGRESS')
    case 'mismatch': return fail('REQUEST_MISMATCH')
  }

  let r: EngineResult<T>
  try {
    r = await body()
  } catch (e) {
    // 저장 실패 같은 예기치 못한 오류. 요청을 pending 으로 남기면 같은 ID 가 영원히 막힌다.
    await failRequest(deps.db, deps.clock, i.requestId, 'GENERATION_FAILED')
    throw e
  }
  if (r.ok) await finishRequest(deps.db, deps.clock, i.requestId, r.value)
  else await failRequest(deps.db, deps.clock, i.requestId, r.code)
  return r
}

/** 모델이 모르는 활동을 적으면 모드의 첫 활동으로 둔다 */
function normalizeActivity(h: ModeHarness, gen: MaterialGenT): MaterialGenT {
  return h.activities.some((a) => a.id === gen.activity)
    ? gen
    : { ...gen, activity: h.activities[0].id }
}

function materialNotice(version: number, gen: MaterialGenT, firstNumber: number | null): string {
  const n = gen.problems.length
  const range = n > 0 && firstNumber !== null
    ? ` · 문제 ${firstNumber}${n > 1 ? `~${firstNumber + n - 1}` : ''}번`
    : ''
  return `자료 v${version} 「${gen.title}」을 만들었다${range}.`
}

async function firstNumberOf(deps: StudyDeps, sessionId: number, problemIds: number[]) {
  if (problemIds.length === 0) return null
  return (await findProblem(deps.db, sessionId, problemIds[0]))?.number ?? null
}

// ── 시작 ──────────────────────────────────────────

export async function startSession(deps: StudyDeps, i: {
  mode: StudyMode; request: string; requestId: string
}): Promise<EngineResult<{ sessionId: number }>> {
  const h = getMode(i.mode)

  return once(deps, { requestId: i.requestId, action: 'start', sessionId: null }, async () => {
    const call = await paidCall(deps, {
      route: 'study-start', ...WORK,
      system: startSystem(h), user: startUser({ request: i.request }),
      schemaName: 'study_start', jsonSchema: startJsonSchema,
      parse: (x) => StartGen.safeParse(x),
      subject: i.mode, requestId: i.requestId, sessionId: null,
    })
    // 실패하면 세션을 만들지 않는다. 요청 원문은 화면의 초안에 남아 있다.
    if (!call.ok) return fail(call.code)

    const gen = call.data
    const title = gen.material.title.trim() || i.request.slice(0, 30)
    const sessionId = await createSession(deps.db, deps.clock, { mode: i.mode, request: i.request, title })
    await appendMessage(deps.db, deps.clock, {
      sessionId, role: 'user', kind: 'chat', bodyMd: i.request, requestId: i.requestId,
    })

    if (gen.outcome === 'clarify') {
      await appendMessage(deps.db, deps.clock, {
        sessionId, role: 'assistant', kind: 'chat', bodyMd: gen.clarify_question, requestId: i.requestId,
      })
    } else {
      const m = normalizeActivity(h, gen.material)
      const ins = await insertMaterial(deps.db, deps.clock, {
        sessionId, parentId: null, requestId: i.requestId, gen: m,
      })
      await appendMessage(deps.db, deps.clock, {
        sessionId, role: 'assistant', kind: 'material', requestId: i.requestId,
        materialId: ins.materialId,
        bodyMd: materialNotice(ins.version, m, await firstNumberOf(deps, sessionId, ins.problemIds)),
      })
    }
    return done({ sessionId })
  })
}

// ── 자료 만들기 (more 와 대화의 more_material 이 같이 쓴다) ──

async function makeMaterial(
  deps: StudyDeps, h: ModeHarness, sessionId: number, instruction: string, requestId: string,
): Promise<EngineResult<{ materialId: number }>> {
  const ctx = await buildMaterialContext(deps.db, sessionId, instruction)
  if (!ctx) return fail('NOT_FOUND')

  const call = await paidCall(deps, {
    route: 'study-material', ...WORK,
    system: materialSystem(h), user: materialUser(ctx),
    schemaName: 'study_material', jsonSchema: materialJsonSchema,
    parse: (x) => MaterialGen.safeParse(x),
    subject: h.id, requestId, sessionId,
  })
  if (!call.ok) return fail(call.code)

  const gen = normalizeActivity(h, call.data)
  const ins = await insertMaterial(deps.db, deps.clock, {
    sessionId, parentId: await latestMaterialId(deps.db, sessionId), requestId, gen,
  })
  await appendMessage(deps.db, deps.clock, {
    sessionId, role: 'assistant', kind: 'material', requestId, materialId: ins.materialId,
    bodyMd: materialNotice(ins.version, gen, await firstNumberOf(deps, sessionId, ins.problemIds)),
  })
  return done({ materialId: ins.materialId })
}

async function sessionMode(deps: StudyDeps, sessionId: number): Promise<ModeHarness | null> {
  const s = await getSession(deps.db, sessionId)
  return s ? getMode(s.studyMode as StudyMode) : null
}

export async function requestMore(deps: StudyDeps, i: {
  sessionId: number; instruction: string; requestId: string
}): Promise<EngineResult<{ materialId: number }>> {
  const h = await sessionMode(deps, i.sessionId)
  if (!h) return fail('NOT_FOUND')

  return once(deps, { requestId: i.requestId, action: 'more', sessionId: i.sessionId }, async () => {
    if (i.instruction.trim()) {
      await appendMessage(deps.db, deps.clock, {
        sessionId: i.sessionId, role: 'user', kind: 'chat', bodyMd: i.instruction, requestId: i.requestId,
      })
    }
    const r = await makeMaterial(deps, h, i.sessionId, i.instruction, i.requestId)
    if (!r.ok) await notice(deps, i.sessionId, i.requestId, `자료를 만들지 못했다 — ${r.message}`)
    return r
  })
}

async function notice(deps: StudyDeps, sessionId: number, requestId: string, bodyMd: string, problemId?: number) {
  await appendMessage(deps.db, deps.clock, {
    sessionId, role: 'assistant', kind: 'notice', bodyMd, requestId, problemId: problemId ?? null,
  })
}

// ── 대화 ──────────────────────────────────────────

export async function sendMessage(deps: StudyDeps, i: {
  sessionId: number; text: string; problemId?: number; requestId: string
}): Promise<EngineResult<{ materialId: number | null }>> {
  const h = await sessionMode(deps, i.sessionId)
  if (!h) return fail('NOT_FOUND')

  return once(deps, { requestId: i.requestId, action: 'message', sessionId: i.sessionId }, async () => {
    // 문맥은 이번 메시지를 넣기 전에 만든다 — 「지금 메시지」가 최근 대화에 두 번 들어가지 않게.
    const ctx = await buildChatContext(deps.db, i.sessionId, { text: i.text, problemId: i.problemId })
    if (!ctx) return fail('NOT_FOUND')

    // 학습자 메시지는 먼저 남긴다. 호출이 실패해도 질문은 사라지지 않는다.
    await appendMessage(deps.db, deps.clock, {
      sessionId: i.sessionId, role: 'user', kind: 'chat', bodyMd: i.text,
      requestId: i.requestId, problemId: ctx.focus?.id ?? null,
    })

    const call = await paidCall(deps, {
      route: 'study-chat', ...CHAT,
      system: chatSystem(h), user: chatUser(ctx),
      schemaName: 'study_chat', jsonSchema: chatJsonSchema,
      parse: (x) => ChatGen.safeParse(x),
      subject: h.id, requestId: i.requestId, sessionId: i.sessionId,
    })
    if (!call.ok) {
      await notice(deps, i.sessionId, i.requestId, `답하지 못했다 — ${MESSAGES[call.code]}`)
      return fail(call.code)
    }

    const chat = call.data
    // 모델이 번호를 주면 그 번호로, 아니면 문맥이 이미 고른 문제로.
    const target = chat.problem_number > 0
      ? await findProblemByNumber(deps.db, i.sessionId, chat.problem_number)
      : ctx.focus ? await findProblem(deps.db, i.sessionId, ctx.focus.id) : null

    await appendMessage(deps.db, deps.clock, {
      sessionId: i.sessionId, role: 'assistant', kind: 'chat', bodyMd: chat.reply_md,
      requestId: i.requestId, problemId: target?.id ?? null,
    })
    await appendSessionNote(deps.db, deps.clock, i.sessionId, chat.note)

    if (chat.intent === 'reveal_solution') {
      // 서버가 연다. 이 세션의 문제일 때만 — findProblemByNumber 가 세션으로 묶는다.
      if (target) {
        await revealSolution(deps.db, target.id)
        await notice(deps, i.sessionId, i.requestId, `${target.number}번 문제의 해설을 열었다.`, target.id)
      } else {
        await notice(deps, i.sessionId, i.requestId, '해설을 열 문제를 찾지 못했다. 문제의 「해설 보기」를 눌러라.')
      }
    }

    if (chat.intent === 'new_topic') {
      await notice(deps, i.sessionId, i.requestId, '주제가 크게 바뀐다. 홈에서 새 학습으로 시작하면 이 대화가 섞이지 않는다.')
    }

    if (chat.intent === 'more_material') {
      const made = await makeMaterial(deps, h, i.sessionId, chat.material_instruction || i.text, i.requestId)
      if (!made.ok) {
        // 답변은 이미 저장됐다. 자료만 못 만든 것을 알린다 — 대화 자체는 성공이다.
        await notice(deps, i.sessionId, i.requestId, `자료를 만들지 못했다 — ${made.message}`)
        return done({ materialId: null })
      }
      return done({ materialId: made.value.materialId })
    }

    return done({ materialId: null })
  })
}

// ── 제출 ──────────────────────────────────────────

/**
 * 판정은 서버가 정한다 (커리큘럼 경로의 `reconcilePoints` 와 같은 원칙).
 * 루브릭이 있으면 맞은 기준 수로, 없으면 모델의 판정을 쓴다.
 */
function verdictOf(rubric: string[], correct: string[], modelVerdict: string): string {
  if (rubric.length === 0) return modelVerdict
  if (correct.length === rubric.length) return 'correct'
  if (correct.length === 0) return 'incorrect'
  return 'partial'
}

export async function submitAnswer(deps: StudyDeps, i: {
  sessionId: number; problemId: number; answer: string; language: string | null
  feedbackMode: FeedbackMode; requestId: string
}): Promise<EngineResult<{ submissionId: number }>> {
  const h = await sessionMode(deps, i.sessionId)
  if (!h) return fail('NOT_FOUND')
  // ★ 세션 경계. 다른 세션의 문제면 여기서 끝난다 — 호출도 요청 기록도 없다.
  const problem = await findProblem(deps.db, i.sessionId, i.problemId)
  if (!problem) return fail('NOT_FOUND')

  return once(deps, { requestId: i.requestId, action: 'submit', sessionId: i.sessionId }, async () => {
    if (await submissionCount(deps.db, i.problemId) >= MAX_ATTEMPTS) return fail('ATTEMPT_LIMIT')

    const ctx = await buildFeedbackContext(
      deps.db, i.sessionId, i.problemId, i.answer, i.language, i.feedbackMode,
    )
    if (!ctx) return fail('NOT_FOUND')

    const call = await paidCall(deps, {
      route: 'study-feedback', ...WORK,
      system: feedbackSystem(h, i.feedbackMode), user: feedbackUser(ctx),
      schemaName: 'study_feedback', jsonSchema: feedbackJsonSchema,
      parse: (x) => FeedbackGen.safeParse(x),
      subject: h.id, requestId: i.requestId, sessionId: i.sessionId,
    })
    if (!call.ok) return fail(call.code)

    const fb = call.data
    const rubric = StoredProblemPrivate.parse(problem.private).rubric
    const points = reconcilePoints(rubric, fb)
    const verdict = verdictOf(rubric, points.correct_points, fb.verdict)

    // ★ 루브릭 문장은 저장된 피드백에 남기되, 화면으로는 개수만 나간다 (store.loadSessionView).
    // 「오류만」이면 고친 답을 버린다 — 모델이 지시를 어겨도 저장되지 않는다.
    const feedback = {
      ...fb,
      ...points,
      improved_md: i.feedbackMode === 'errors-only' ? '' : fb.improved_md,
      model_verdict: fb.verdict,
      verdict,
      review_label: h.reviewLabel,
    }

    const sub = await insertSubmission(deps.db, deps.clock, {
      problemId: i.problemId, answer: i.answer, language: i.language,
      feedbackMode: i.feedbackMode, feedback, verdict, requestId: i.requestId,
    })
    await appendMessage(deps.db, deps.clock, {
      sessionId: i.sessionId, role: 'assistant', kind: 'feedback', requestId: i.requestId,
      problemId: i.problemId,
      bodyMd: `${problem.number}번 ${sub.attemptNo}차 제출 · ${h.reviewLabel}: ${fb.summary_md}`,
    })
    return done({ submissionId: sub.id })
  })
}

// ── 힌트·해설 (0원) ───────────────────────────────

export async function revealHint(deps: StudyDeps, i: { problemId: number }): Promise<EngineResult<{ hint: string; hintsRevealed: number }>> {
  const sessionId = await problemSession(deps.db, i.problemId)
  if (sessionId === null) return fail('NOT_FOUND')
  const before = await findProblem(deps.db, sessionId, i.problemId)
  if (!before) return fail('NOT_FOUND')
  const hints = StoredProblemPrivate.parse(before.private).hints
  if (before.hintsRevealed >= hints.length) return fail('NO_MORE_HINTS')

  const n = await revealNextHint(deps.db, i.problemId)
  return done({ hint: hints[n - 1] ?? '', hintsRevealed: n })
}

export async function revealSolutionFor(deps: StudyDeps, i: { problemId: number }): Promise<EngineResult<{ answer_md: string; solution_md: string }>> {
  const sessionId = await problemSession(deps.db, i.problemId)
  if (sessionId === null) return fail('NOT_FOUND')
  const p = await findProblem(deps.db, sessionId, i.problemId)
  if (!p) return fail('NOT_FOUND')

  const priv = StoredProblemPrivate.parse(p.private)
  if (!p.solutionRevealed) {
    await revealSolution(deps.db, p.id)
    await appendMessage(deps.db, deps.clock, {
      sessionId, role: 'assistant', kind: 'notice', problemId: p.id,
      bodyMd: `${p.number}번 문제의 해설을 열었다.`,
    })
  }
  return done({ answer_md: priv.answer_md, solution_md: priv.solution_md })
}
