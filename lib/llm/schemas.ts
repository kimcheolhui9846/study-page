import { z } from 'zod'

/**
 * OpenAI Structured Outputs 의 strict 모드는 세 가지를 요구한다:
 *   - 모든 object 에 "additionalProperties": false
 *   - 모든 object 의 required 가 properties 의 모든 키를 담을 것
 *   - 따라서 선택 필드를 만들 수 없다
 *
 * hint 가 필수인 이유가 그것이다. 빈 문자열은 허용한다.
 *
 * zod 를 한 겹 더 두는 이유: Structured Outputs 가 형식을 강제하지만
 * 그건 OpenAI 쪽 디코딩의 보장이다. 우리 DB 에 넣기 전에 우리 코드로도
 * 확인한다 — 스키마를 고쳤는데 한쪽만 고치는 실수를 zod 가 잡는다.
 */

// ── ① 콘텐츠 생성 ─────────────────────────────────

export const CONTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passage', 'questions'],
  properties: {
    passage: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body_md', 'key_terms'],
      properties: {
        title: { type: 'string' },
        body_md: { type: 'string' },
        key_terms: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['term', 'definition'],
            properties: {
              term: { type: 'string' },
              definition: { type: 'string' },
            },
          },
        },
      },
    },
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'prompt', 'expected_points', 'hint'],
        properties: {
          id: { type: 'string', enum: ['q1', 'q2', 'q3'] },
          type: { type: 'string', enum: ['recall', 'concept', 'application'] },
          prompt: { type: 'string' },
          expected_points: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
        },
      },
    },
  },
} as const

export const ContentSchema = z.object({
  passage: z.object({
    title: z.string().min(1),
    body_md: z.string().min(1),
    key_terms: z.array(z.object({ term: z.string(), definition: z.string() })),
  }),
  questions: z.array(z.object({
    id: z.enum(['q1', 'q2', 'q3']),
    type: z.enum(['recall', 'concept', 'application']),
    prompt: z.string().min(1),
    // 루브릭이 비면 채점할 근거가 없다. 형식은 맞아도 쓸모가 없으므로 거른다.
    expected_points: z.array(z.string().min(1)).min(1),
    // strict 모드가 선택 필드를 못 만들어서 필수다. 빈 문자열은 허용한다.
    hint: z.string(),
  })).length(3),
})

export type GeneratedContent = z.infer<typeof ContentSchema>

// ── ② 채점 ─────────────────────────────────────

export const GRADE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['per_question', 'overall', 'summary_seed'],
  properties: {
    per_question: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'score', 'correct_points', 'missed_points',
                   'misconceptions', 'feedback_ko'],
        properties: {
          id: { type: 'string' },
          score: { type: 'integer' },
          correct_points: { type: 'array', items: { type: 'string' } },
          missed_points: { type: 'array', items: { type: 'string' } },
          misconceptions: { type: 'array', items: { type: 'string' } },
          feedback_ko: { type: 'string' },
        },
      },
    },
    overall: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'goal_reached', 'verdict'],
      properties: {
        score: { type: 'integer' },
        goal_reached: { type: 'boolean' },
        verdict: { type: 'string', enum: ['pass', 'revise'] },
      },
    },
    summary_seed: { type: 'array', items: { type: 'string' } },
  },
} as const

const Score = z.number().int().min(0).max(100)

export const GradeSchema = z.object({
  per_question: z.array(z.object({
    id: z.string().min(1),
    score: Score,
    correct_points: z.array(z.string()),
    missed_points: z.array(z.string()),
    misconceptions: z.array(z.string()),
    feedback_ko: z.string().min(1),
  })).min(1),
  overall: z.object({
    score: Score,
    goal_reached: z.boolean(),
    verdict: z.enum(['pass', 'revise']),
  }),
  // 3주차 정리본 화면이 이걸 체크리스트로 쓴다. 비면 그 화면이 빈 껍데기가 된다.
  summary_seed: z.array(z.string().min(1)).min(1),
})

export type GradeResult = z.infer<typeof GradeSchema>
