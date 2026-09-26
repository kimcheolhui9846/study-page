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

/**
 * 해설. **채점을 받은 뒤에만 보인다.**
 *
 * ★ 학습자가 막히던 자리가 여기였다. 「놓침 — 'propose'의 정의」 같은 루브릭
 * 조각만 보고 같은 지문으로 다시 푸는 구조라, 틀린 채로 다시 틀렸다.
 * 실제로 6개 Topic 중 5개가 두 번씩 틀리고 `weak` 로 남아 있었다.
 *
 * 세 조각으로 나눠 받는다. 마크다운 한 덩어리로 받으면 모델이 매번 다르게
 * 구성해 화면이 일정하지 않고, 빠뜨려도 알 수 없다.
 *
 * ★ `expected_points` · `hint` 와 같은 급의 비밀이다. `publicQuestions` 가
 * 지운다 — 학습 화면에 새면 이 앱은 의미가 없다.
 */
const SolutionSchema = z.object({
  /** 온전한 답이 어떤 모습인지 */
  answer_md: z.string().min(1),
  /** 답에 이르는 단계. 정의 문제면 1~2, 계산이면 3~5 */
  steps: z.array(z.string().min(1)).min(1),
  /**
   * 지문에서 근거가 된 문장 그대로.
   *
   * 「몇 번째 문단」이 아니라 문장을 옮기게 하는 이유: 지문이 한 덩어리
   * 마크다운이라 위치 참조가 불안정하다. 지문 밖에서 생각해야 하는
   * 문제면 빈 문자열이다.
   */
  evidence: z.string(),
})

export type Solution = z.infer<typeof SolutionSchema>

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
        required: ['id', 'type', 'prompt', 'expected_points', 'hint', 'solution'],
        properties: {
          id: { type: 'string', enum: ['q1', 'q2', 'q3'] },
          type: { type: 'string', enum: ['recall', 'concept', 'application'] },
          prompt: { type: 'string' },
          expected_points: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
          solution: {
            type: 'object',
            additionalProperties: false,
            required: ['answer_md', 'steps', 'evidence'],
            properties: {
              answer_md: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
              evidence: { type: 'string' },
            },
          },
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
    solution: SolutionSchema,
  })).length(3),
})

export type GeneratedContent = z.infer<typeof ContentSchema>

// ── ② 복습 콘텐츠 ───────────────────────────────

/**
 * 복습은 지문을 다시 주지 않는다.
 *
 * 이미 한 번 읽은 글을 또 읽는 건 복습이 아니라 재독이다. 짧은 되짚기와
 * 문제만 준다 — 출력 토큰이 절반 이하로 줄고, 그것이 복습의 정의에 더 맞다.
 *
 * 문제는 2개다. `review_items` 의 CHECK(round BETWEEN 1 AND 4)가 회차를
 * 묶으므로 Topic 당 복습 생성은 최대 4회다.
 */
export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recap_md', 'questions'],
  properties: {
    recap_md: { type: 'string' },
    questions: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'prompt', 'expected_points', 'hint', 'solution'],
        properties: {
          id: { type: 'string', enum: ['q1', 'q2'] },
          type: { type: 'string', enum: ['recall', 'concept', 'application'] },
          prompt: { type: 'string' },
          expected_points: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
          solution: {
            type: 'object',
            additionalProperties: false,
            required: ['answer_md', 'steps', 'evidence'],
            properties: {
              answer_md: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
              evidence: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const

export const ReviewSchema = z.object({
  recap_md: z.string().min(1),
  questions: z.array(z.object({
    id: z.enum(['q1', 'q2']),
    type: z.enum(['recall', 'concept', 'application']),
    prompt: z.string().min(1),
    expected_points: z.array(z.string().min(1)).min(1),
    hint: z.string(),
    solution: SolutionSchema,
  })).length(2),
})

export type GeneratedReview = z.infer<typeof ReviewSchema>

/**
 * 화면과 채점이 보는 공통 모양.
 *
 * 신규 콘텐츠는 지문 + 문제 3개, 복습은 되짚기 + 문제 2개다. 둘을 여기로
 * 좁혀 두면 학습 화면과 채점기가 어느 쪽인지 알 필요가 없다.
 */
export interface StudyMaterial {
  title: string
  bodyMd: string
  keyTerms: Array<{ term: string; definition: string }>
  questions: GeneratedContent['questions'] | GeneratedReview['questions']
}

export function materialOfContent(c: GeneratedContent): StudyMaterial {
  return {
    title: c.passage.title,
    bodyMd: c.passage.body_md,
    keyTerms: c.passage.key_terms,
    questions: c.questions,
  }
}

export function materialOfReview(r: GeneratedReview, title: string): StudyMaterial {
  return { title, bodyMd: r.recap_md, keyTerms: [], questions: r.questions }
}

// ── ③ 채점 ─────────────────────────────────────

/**
 * ★ 채점은 계획 단위로 한 번 부른다. 그래서 응답이 Topic 배열이다.
 *
 * 항목마다 부르면 하루 호출이 (생성 N + 채점 N)이 된다. 한 번으로 묶으면
 * (생성 N + 1)이다. 채점 기준은 루브릭이라 Topic 이 섞여도 흔들리지 않는다.
 *
 * ★ 모델에게 점수를 묻지 않는다.
 * 2주차에 gpt-4o-mini 가 0/3 포인트짜리 답안에 50점을 줬다 — 자기가 명시한
 * 계산식을 어겼다. 점수는 `lib/mastery/score.ts` 가 포인트 개수로 만든다.
 * 안 읽을 필드를 남겨두면 언젠가 누가 읽는다. 그래서 아예 받지 않는다.
 */
export const GRADE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic_id', 'questions', 'summary_seed',
                   'missing_prerequisites', 'weak_concepts'],
        properties: {
          topic_id: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'correct_points', 'missed_points',
                         'misconceptions', 'feedback_ko'],
              properties: {
                id: { type: 'string' },
                correct_points: { type: 'array', items: { type: 'string' } },
                missed_points: { type: 'array', items: { type: 'string' } },
                misconceptions: { type: 'array', items: { type: 'string' } },
                feedback_ko: { type: 'string' },
              },
            },
          },
          summary_seed: { type: 'array', items: { type: 'string' } },
          // 모델의 제안일 뿐이다. 보충 Topic 의 결정은 그래프가 한다 (설계 §9.2)
          missing_prerequisites: { type: 'array', items: { type: 'string' } },
          weak_concepts: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

export const GradedQuestionSchema = z.object({
  id: z.string().min(1),
  correct_points: z.array(z.string()),
  missed_points: z.array(z.string()),
  misconceptions: z.array(z.string()),
  feedback_ko: z.string().min(1),
})

export const GradedTopicSchema = z.object({
  topicId: z.string().min(1),
  questions: z.array(GradedQuestionSchema).min(1),
  // 정리본 화면이 체크리스트로 쓴다. 비면 그 화면이 빈 껍데기가 된다.
  summarySeed: z.array(z.string().min(1)).min(1),
  // 힌트일 뿐이라 비어 있어도 정상이다
  missingPrerequisites: z.array(z.string().min(1)),
  weakConcepts: z.array(z.string().min(1)),
})

/** 모델의 snake_case 응답을 우리 camelCase 로 옮기며 검증한다. */
export const GradeSchema = z.object({
  topics: z.array(z.object({
    topic_id: z.string().min(1),
    questions: z.array(GradedQuestionSchema).min(1),
    summary_seed: z.array(z.string().min(1)).min(1),
    missing_prerequisites: z.array(z.string().min(1)),
    weak_concepts: z.array(z.string().min(1)),
  })).min(1),
}).transform((g) => ({
  topics: g.topics.map((t) => ({
    topicId: t.topic_id,
    questions: t.questions,
    summarySeed: t.summary_seed,
    missingPrerequisites: t.missing_prerequisites,
    weakConcepts: t.weak_concepts,
  })),
}))

export type GradedTopic = z.infer<typeof GradedTopicSchema>
export type GradeResult = z.infer<typeof GradeSchema>

// ── ④ 화면으로 나가는 모양 ────────────────────────

/**
 * ★ 학습자에게 보내는 문항. `expected_points` 와 `hint` 가 빠져 있다.
 *
 * 루브릭이 클라이언트로 나가면 답이 나가는 것과 같다. 힌트는 눌렀을 때만
 * 따로 가져온다 — 페이지 소스에 있으면 힌트가 아니다.
 */
export interface PublicQuestion {
  id: string
  type: string
  prompt: string
}

export function publicQuestions(m: StudyMaterial): PublicQuestion[] {
  return m.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt }))
}

/**
 * 해설을 문제 id 로 꺼낸다. **채점 결과 화면에서만 쓴다.**
 *
 * ★ `publicQuestions` 를 넓히지 않고 길을 따로 낸 이유: 그 함수의 이름은
 * 「채점 전에 보여도 되는 것」이라는 뜻이고, 그 뜻이 흐려지면 다음 사람이
 * 거기에 비밀을 하나 더 얹는다. 해설을 꺼내는 쪽은 이름으로 드러나야 한다.
 */
export function solutionsOf(m: StudyMaterial): Record<string, Solution> {
  return Object.fromEntries(m.questions.map((q) => [q.id, q.solution]))
}

export function hintFor(m: StudyMaterial, questionId: string): string | null {
  return m.questions.find((q) => q.id === questionId)?.hint ?? null
}
