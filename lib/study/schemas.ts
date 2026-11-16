import { z } from 'zod'

/**
 * 자유학습의 스키마.
 *
 * ★ 두 벌이다 (AGENTS.md 「저장된 데이터를 읽는 스키마는 따로다」).
 *   - 생성 스키마(…Gen)  — 모델 응답을 검증한다. 필드 **필수**
 *   - 저장 스키마(Stored…) — DB 의 행을 읽는다. 필드 **선택**, 모르는 필드 허용
 *
 * JSON Schema 는 OpenAI Structured Outputs strict 모드용이다 — 모든 object 에
 * additionalProperties:false, required 는 모든 키. 그래서 「없음」은 빈 문자열·0 이다.
 */

// ── 생성: 자료 ─────────────────────────────────────

export const BLOCK_KINDS = ['explain', 'example', 'code', 'table', 'passage'] as const
export const PROBLEM_KINDS = ['short', 'calc', 'proof', 'writing', 'code'] as const
export const MAX_BLOCKS = 8
export const MAX_PROBLEMS = 5

const SpecGen = z.object({
  input_md: z.string(),
  output_md: z.string(),
  constraints_md: z.string(),
  examples_md: z.string(),
})

export const ProblemGen = z.object({
  prompt_md: z.string().min(1),
  kind: z.enum(PROBLEM_KINDS),
  spec: SpecGen,
  answer_md: z.string(),
  rubric: z.array(z.string()),
  solution_md: z.string(),
  hints: z.array(z.string()).length(3),
})
export type ProblemGenT = z.infer<typeof ProblemGen>

export const MaterialGen = z.object({
  title: z.string().min(1),
  activity: z.string(),
  blocks: z.array(z.object({
    kind: z.enum(BLOCK_KINDS),
    title: z.string(),
    body_md: z.string(),
  })).max(MAX_BLOCKS),
  problems: z.array(ProblemGen).max(MAX_PROBLEMS),
})
export type MaterialGenT = z.infer<typeof MaterialGen>

/** 세션 시작. 자료를 주거나, 요청이 너무 넓으면 짧게 되묻는다 — 한 번의 호출로 */
export const StartGen = z.object({
  outcome: z.enum(['material', 'clarify']),
  clarify_question: z.string(),
  material: MaterialGen,
}).refine(
  (x) => x.outcome === 'clarify'
    ? x.clarify_question.trim().length > 0
    : x.material.blocks.length > 0,
  { message: 'material 이면 자료 블록이, clarify 면 질문이 있어야 한다' },
)
export type StartGenT = z.infer<typeof StartGen>

// ── 생성: 대화 ─────────────────────────────────────

export const CHAT_INTENTS = ['answer', 'more_material', 'reveal_solution', 'new_topic'] as const

export const ChatGen = z.object({
  reply_md: z.string(),
  intent: z.enum(CHAT_INTENTS),
  /** 지목한 문제의 세션 번호. 없으면 0 */
  problem_number: z.number().int().min(0),
  /** intent 가 more_material 일 때 자료를 어떻게 만들지 */
  material_instruction: z.string(),
  /** 세션 요약에 덧붙일 한두 문장 — 수준·선호·막힌 지점 */
  note: z.string(),
})
export type ChatGenT = z.infer<typeof ChatGen>

// ── 생성: 피드백 ───────────────────────────────────

export const VERDICTS = ['correct', 'partial', 'incorrect'] as const

export const FeedbackGen = z.object({
  verdict: z.enum(VERDICTS),
  summary_md: z.string(),
  issues: z.array(z.object({ where: z.string(), why: z.string(), fix_hint: z.string() })),
  correct_points: z.array(z.string()),
  missed_points: z.array(z.string()),
  /** 고친 답·더 나은 표현. 「오류만」 모드에서는 서버가 비운다 */
  improved_md: z.string(),
})
export type FeedbackGenT = z.infer<typeof FeedbackGen>

// ── JSON Schema ───────────────────────────────────

const str = { type: 'string' } as const
const strArr = { type: 'array', items: str } as const

function obj(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const
}

const problemJson = obj({
  prompt_md: str,
  kind: { type: 'string', enum: PROBLEM_KINDS },
  spec: obj({ input_md: str, output_md: str, constraints_md: str, examples_md: str }),
  answer_md: str,
  rubric: strArr,
  solution_md: str,
  hints: { type: 'array', items: str, minItems: 3, maxItems: 3 },
})

export const materialJsonSchema = obj({
  title: str,
  activity: str,
  blocks: {
    type: 'array',
    maxItems: MAX_BLOCKS,
    items: obj({ kind: { type: 'string', enum: BLOCK_KINDS }, title: str, body_md: str }),
  },
  problems: { type: 'array', maxItems: MAX_PROBLEMS, items: problemJson },
})

export const startJsonSchema = obj({
  outcome: { type: 'string', enum: ['material', 'clarify'] },
  clarify_question: str,
  material: materialJsonSchema,
})

export const chatJsonSchema = obj({
  reply_md: str,
  intent: { type: 'string', enum: CHAT_INTENTS },
  problem_number: { type: 'integer' },
  material_instruction: str,
  note: str,
})

export const feedbackJsonSchema = obj({
  verdict: { type: 'string', enum: VERDICTS },
  summary_md: str,
  issues: { type: 'array', items: obj({ where: str, why: str, fix_hint: str }) },
  correct_points: strArr,
  missed_points: strArr,
  improved_md: str,
})

// ── 저장 ──────────────────────────────────────────

/** study_materials.content — 공개부만 담는다 */
export const StoredMaterialContent = z.looseObject({
  title: z.string().default(''),
  blocks: z.array(z.looseObject({
    kind: z.string().default('explain'),
    title: z.string().default(''),
    body_md: z.string().default(''),
  })).default([]),
})
export type StoredMaterialContentT = z.infer<typeof StoredMaterialContent>

export const StoredProblemPublic = z.looseObject({
  prompt_md: z.string().default(''),
  kind: z.string().default('short'),
  spec: z.looseObject({
    input_md: z.string().default(''),
    output_md: z.string().default(''),
    constraints_md: z.string().default(''),
    examples_md: z.string().default(''),
  }).nullable().default(null),
})

export const StoredProblemPrivate = z.looseObject({
  answer_md: z.string().default(''),
  rubric: z.array(z.string()).default([]),
  solution_md: z.string().default(''),
  hints: z.array(z.string()).default([]),
})
export type StoredProblemPrivateT = z.infer<typeof StoredProblemPrivate>

export const StoredFeedback = z.looseObject({
  verdict: z.string().default('partial'),
  summary_md: z.string().default(''),
  issues: z.array(z.looseObject({
    where: z.string().default(''),
    why: z.string().default(''),
    fix_hint: z.string().default(''),
  })).default([]),
  correct_points: z.array(z.string()).default([]),
  missed_points: z.array(z.string()).default([]),
  improved_md: z.string().default(''),
})
export type StoredFeedbackT = z.infer<typeof StoredFeedback>

/**
 * 화면으로 나가는 피드백. 루브릭 문장(correct_points·missed_points)은 빼고 개수만 —
 * 맞은·놓친 기준 문장을 보여 주면 그 자체가 정답 목록이 된다.
 */
export interface PublicFeedback {
  verdict: string
  summary_md: string
  issues: Array<{ where: string; why: string; fix_hint: string }>
  improved_md: string
  correctCount: number
  totalCount: number
  reviewLabel: string
}

export function publicFeedback(raw: unknown): PublicFeedback {
  const parsed = StoredFeedback.safeParse(raw)
  const f = parsed.success ? parsed.data : StoredFeedback.parse({})
  const label = (raw as { review_label?: unknown } | null)?.review_label
  return {
    verdict: f.verdict,
    summary_md: f.summary_md,
    issues: f.issues.map((x) => ({ where: x.where, why: x.why, fix_hint: x.fix_hint })),
    improved_md: f.improved_md,
    correctCount: f.correct_points.length,
    totalCount: f.correct_points.length + f.missed_points.length,
    reviewLabel: typeof label === 'string' ? label : 'AI 검토',
  }
}

/** 생성된 문제를 공개부와 비공개부로 가른다. DB 의 두 컬럼에 따로 들어간다 */
export function splitProblem(p: ProblemGenT): { pub: object; priv: object } {
  const s = p.spec
  const hasSpec = [s.input_md, s.output_md, s.constraints_md, s.examples_md]
    .some((v) => v.trim().length > 0)
  return {
    pub: { prompt_md: p.prompt_md, kind: p.kind, spec: hasSpec ? s : null },
    priv: { answer_md: p.answer_md, rubric: p.rubric, solution_md: p.solution_md, hints: p.hints },
  }
}

// ── 공개 투영 ─────────────────────────────────────

export interface PublicProblem {
  id: number
  number: number
  kind: string
  prompt_md: string
  spec: { input_md: string; output_md: string; constraints_md: string; examples_md: string } | null
  /** 학습자가 연 힌트만 */
  hints: string[]
  hintsLeft: number
  /** 학습자가 해설을 연 뒤에만. 루브릭은 끝까지 나가지 않는다 */
  solution: { answer_md: string; solution_md: string } | null
}

/**
 * ★ 밖으로 나가는 문제의 키. 여기에 필드를 더하려면 이 목록과
 * tests/study/schemas.test.ts 를 함께 고쳐야 한다 — 비밀이 슬쩍 얹히지 않게.
 */
export const PUBLIC_PROBLEM_KEYS = [
  'id', 'number', 'kind', 'prompt_md', 'spec', 'hints', 'hintsLeft', 'solution',
] as const

export interface ProblemRowLike {
  id: number
  number: number
  public: unknown
  private: unknown
  hintsRevealed: number
  solutionRevealed: boolean
}

export function publicProblem(row: ProblemRowLike): PublicProblem {
  const pub = StoredProblemPublic.parse(row.public)
  const priv = StoredProblemPrivate.parse(row.private)
  const spec = pub.spec
    ? {
        input_md: pub.spec.input_md,
        output_md: pub.spec.output_md,
        constraints_md: pub.spec.constraints_md,
        examples_md: pub.spec.examples_md,
      }
    : null
  const shown = Math.min(row.hintsRevealed, priv.hints.length)

  return {
    id: row.id,
    number: row.number,
    kind: pub.kind,
    prompt_md: pub.prompt_md,
    spec,
    hints: priv.hints.slice(0, shown),
    hintsLeft: priv.hints.length - shown,
    solution: row.solutionRevealed
      ? { answer_md: priv.answer_md, solution_md: priv.solution_md }
      : null,
  }
}
