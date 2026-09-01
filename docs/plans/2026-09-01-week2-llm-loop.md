# 2주차 구현 계획 — 실제 LLM 연결 · 학습 화면 · 채점

> **에이전트에게:** 이 계획은 `superpowers:executing-plans` 또는
> `superpowers:subagent-driven-development` 로 태스크 단위로 실행한다.
> 스텝은 체크박스(`- [ ]`)로 추적한다.

**목표:** CS Day 1 을 실제로 완주한다 — 진짜 LLM 이 지문과 문제를 만들고,
사용자가 서술형 3문제를 풀고, 루브릭 대조 채점을 받는다.

**아키텍처:** 1주차에 세운 4겹 방어선은 그대로 두고 `FakeLlmClient` 자리에
`OpenAiLlmClient` 를 끼운다. 호출 계약(프롬프트·스키마·파라미터)은
스펙 §5 에 확정돼 있으므로 이 계획은 그것을 코드로 옮기는 일이다.
채점은 `lib/study/content.ts` 와 같은 모양의 오케스트레이션
(`lib/study/grade.ts`)을 하나 더 만들어 처리한다.

**스택:** Next 16.3.3 · React 19 · Tailwind 4 · Drizzle · Neon ·
`gpt-4o-mini` (Structured Outputs) · Vitest + PGlite

---

## ★ 이 계획이 1주차와 다른 점: 여기서부터 돈이 나간다

Task 4 에서 첫 실호출이 일어난다. 그 전에 **반드시** 확인한다:

- OpenAI 선불 잔액이 남아 있고 **자동 충전이 꺼져 있다** (`docs/DECISIONS.md`)
- Organization spend limit $5, 알림 $3.50
- `.env.local` 의 `APP_ENV=local` (일일 캡 3회 — 개발 중 사고를 커피값으로 막는다)

**개발 중에는 일일 캡이 3이다.** 하루에 네 번째 호출은 429 로 막힌다.
이건 버그가 아니라 설계다. 더 필요하면 캡을 올리지 말고 다음 날 이어서 한다.

---

## Global Constraints

이 절의 규칙은 **모든 태스크에 암묵적으로 포함된다.**

- **`OPENAI_API_KEY` 는 `lib/llm/client.ts` 에서만 읽는다.** 다른 파일에서
  `process.env.OPENAI_API_KEY` 를 쓰지 않는다 (Task 4 의 테스트가 강제한다).
- **`NEXT_PUBLIC_` 접두사가 붙은 비밀을 만들지 않는다.** `npm run check:secrets` 가 막는다.
- **테스트에서 실제 LLM 을 호출하지 않는다.** `FakeLlmClient` 를 주입하거나
  `fetch` 를 스텁한다. `FakeLlmClient` 를 지우지 않는다.
- **`new Date()` 로 날짜를 만들지 않는다.** `kstToday(clock.now())` / `kstDateLabel()` 만 쓴다.
  날짜 라벨은 서버 컴포넌트에서만 만든다.
- **`main` 에 직접 커밋하지 않는다.** 태스크마다 브랜치를 따고 PR 을 연다.
- **하트비트 ping 을 넣지 않는다.** `/api/session/status` 를 폴링하지 않는다.
- **`pagehide` beacon 을 `/api/session/end` 로 돌리지 않는다.** 새로고침이 로그아웃이 된다.
- **모델은 `gpt-4o-mini`.** 2026-09-01 확인: deprecated 아님, Structured Outputs 지원,
  컨텍스트 128k, 최대 출력 16,384. 입력 $0.15 / 출력 $0.60 per 1M.
- **`temperature` 는 라우트마다 다르다:** content 0.6 · grade **0.0** · polish 0.4.
  채점의 0 은 필수다 — 같은 답안에 같은 점수가 나와야 채점을 신뢰할 수 있다.
- **`max_tokens` 를 무제한으로 두지 않는다.** 비용 게이트다.
- 커밋 저자는 사용자 단독. AI 공동저자 트레일러를 넣지 않는다.
- 브랜치: `feat/…`, `fix/…`, `chore/…`, `docs/…`. 머지는 squash.

---

## 파일 구조

**새로 만드는 것**

| 파일 | 책임 |
|---|---|
| `lib/llm/pricing.ts` | 토큰 수 → `costMicros`. 단가가 바뀌면 여기만 고친다 |
| `lib/llm/schemas.ts` | content·grade 의 JSON Schema(strict) 와 zod 검증 |
| `lib/llm/prompts.ts` | 시스템 프롬프트 원문 + 사용자 메시지 조립 |
| `lib/llm/client.ts` | **`OPENAI_API_KEY` 의 유일한 소비처.** fetch + Structured Outputs |
| `lib/study/grade.ts` | 채점 오케스트레이션 (4겹 통합 지점, `content.ts` 와 같은 모양) |
| `lib/study/complete.ts` | Day 완료 처리 (`status` → `completed`) |
| `app/api/study/[subject]/grade/route.ts` | 채점 라우트 |
| `app/api/study/[subject]/hint/route.ts` | 힌트 (DB 에서 꺼냄, **LLM 호출 0회**) |
| `app/study/[subject]/page.tsx` | 학습 화면 (서버 컴포넌트) |
| `components/Passage.tsx` | 마크다운 + KaTeX 렌더 |
| `components/AnswerForm.tsx` | 서술형 3문제 입력 + 로컬 초안 보관 |
| `components/GradeResult.tsx` | 채점 결과 + "이 채점이 틀렸다" |

**고치는 것**

| 파일 | 무엇을 |
|---|---|
| `lib/study/content.ts` | 실제 프롬프트·스키마 사용, `model` 을 `'fake'` 대신 실제 값으로 |
| `app/api/study/[subject]/content/route.ts` | `FakeLlmClient` → `OpenAiLlmClient` |
| `lib/llm/types.ts` | `LlmClient.generate` 에 `schema` 인자 추가 |
| `app/page.tsx` | 「시작하기」 버튼을 실제 링크로, 2주차 안내 문구 삭제 |
| `tests/no-real-llm.test.ts` | **지우지 않는다.** 아래 Task 4 참조 |
| `.env.example` | `OPENAI_API_KEY` 항목 추가 |

**의존성 추가**

```
react-markdown remark-math rehype-katex katex
```

`openai` 패키지는 **넣지 않는다.** `fetch` 로 직접 호출한다 — 의존성이 늘지 않고
`AbortSignal.timeout` 을 완전히 제어할 수 있으며 버셀 번들이 가볍다.
Structured Outputs 는 JSON 바디 하나라 SDK 가 필요 없다.

`react-markdown` 은 기본값에서 **원시 HTML 을 렌더하지 않는다** (`rehype-raw` 를
넣지 않는다). LLM 이 만든 마크다운을 그리므로 이 성질이 중요하다.

---

## Task 1: 비용 계산

**Files:**
- Create: `lib/llm/pricing.ts`
- Test: `tests/llm/pricing.test.ts`

**Interfaces:**
- Produces: `MODEL = 'gpt-4o-mini'`, `costMicros(promptTokens: number, completionTokens: number): number`

토큰 수를 비용으로 바꾸는 순수 함수 하나. 단가가 바뀌면 이 파일만 고친다.
정수 마이크로달러로 계산한다 — 부동소수를 누적하면 오차가 쌓인다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/llm/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MODEL, costMicros } from '../../lib/llm/pricing'

describe('costMicros', () => {
  it('모델은 gpt-4o-mini 다', () => {
    expect(MODEL).toBe('gpt-4o-mini')
  })

  it('입력 1M 토큰은 $0.15 = 150,000 마이크로다', () => {
    expect(costMicros(1_000_000, 0)).toBe(150_000)
  })

  it('출력 1M 토큰은 $0.60 = 600,000 마이크로다', () => {
    expect(costMicros(0, 1_000_000)).toBe(600_000)
  })

  it('둘을 더한다', () => {
    expect(costMicros(1_000_000, 1_000_000)).toBe(750_000)
  })

  it('★ 정수를 반환한다 — usage_ledger 가 integer 컬럼이다', () => {
    expect(Number.isInteger(costMicros(1234, 5678))).toBe(true)
  })

  it('0 토큰은 0 이다', () => {
    expect(costMicros(0, 0)).toBe(0)
  })

  it('실제 한 번의 콘텐츠 생성 규모를 계산한다', () => {
    // 입력 500 / 출력 2000 토큰 ≈ $0.0013
    expect(costMicros(500, 2000)).toBe(1275)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/llm/pricing.test.ts`
Expected: FAIL — `lib/llm/pricing` 없음

- [ ] **Step 3: 구현한다**

`lib/llm/pricing.ts`:

```ts
/**
 * 모델과 단가. 2026-09-01 확인값.
 *
 * 단가가 바뀌면 이 파일만 고친다. 다른 곳에서 숫자를 복사하지 않는다.
 * 확인 근거와 다른 모델과의 비교는 docs/DECISIONS.md 에 있다.
 */
export const MODEL = 'gpt-4o-mini'

/** per 1M tokens, USD 마이크로 단위 (1 USD = 1,000,000) */
const INPUT_MICROS_PER_1M = 150_000  // $0.15
const OUTPUT_MICROS_PER_1M = 600_000 // $0.60

/**
 * 토큰 수를 비용으로 바꾼다.
 *
 * 정수 마이크로달러로 계산한다. 부동소수 달러를 누적하면 오차가 쌓이고,
 * usage_ledger.cost_micros 가 integer 컬럼이라 어차피 정수여야 한다.
 * 올림한다 — 비용을 낮게 잡는 실수를 하지 않는다.
 */
export function costMicros(promptTokens: number, completionTokens: number): number {
  const input = (promptTokens * INPUT_MICROS_PER_1M) / 1_000_000
  const output = (completionTokens * OUTPUT_MICROS_PER_1M) / 1_000_000
  return Math.ceil(input + output)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/llm/pricing.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/llm-pricing
git add lib/llm/pricing.ts tests/llm/pricing.test.ts
git commit -m "feat: 토큰 수를 비용으로 바꾸는 순수 함수

정수 마이크로달러로 계산한다. 부동소수 달러를 누적하면 오차가 쌓이고
usage_ledger.cost_micros 가 integer 컬럼이라 어차피 정수여야 한다.
올림한다 — 비용을 낮게 잡는 실수를 하지 않는다.

단가($0.15/$0.60 per 1M)는 2026-09-01 확인값이다. 바뀌면 이 파일만 고친다."
```

---

## Task 2: JSON Schema 와 zod 검증

**Files:**
- Create: `lib/llm/schemas.ts`
- Test: `tests/llm/schemas.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `CONTENT_JSON_SCHEMA` / `GRADE_JSON_SCHEMA` — OpenAI 에 보낼 strict JSON Schema
  - `ContentSchema` / `GradeSchema` — zod. 응답을 한 번 더 검증한다
  - 타입 `GeneratedContent`, `GradeResult`

**왜 두 겹인가:** Structured Outputs 가 형식을 강제하지만, 그것은 OpenAI 쪽
디코딩 단계의 보장이다. 우리 DB 에 넣기 전에 우리 코드로도 확인한다 —
스키마를 고쳤는데 한쪽만 고치는 실수를 zod 가 잡는다.

**strict 모드의 제약:** OpenAI 의 `strict: true` 는 모든 오브젝트에
`"additionalProperties": false` 와 **모든 키를 담은 `required` 배열**을 요구한다.
선택 필드를 만들 수 없다 — 그래서 `hint` 도 필수다 (빈 문자열 허용).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/llm/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CONTENT_JSON_SCHEMA, GRADE_JSON_SCHEMA,
  ContentSchema, GradeSchema,
} from '../../lib/llm/schemas'

/** strict 모드가 요구하는 모양을 재귀로 확인한다 */
function assertStrictShape(node: unknown, path = 'root') {
  if (typeof node !== 'object' || node === null) return
  const n = node as Record<string, unknown>

  if (n.type === 'object') {
    expect(n.additionalProperties, `${path}: additionalProperties`).toBe(false)
    const props = Object.keys((n.properties ?? {}) as object)
    expect(new Set(n.required as string[]), `${path}: required 가 모든 키를 담아야 한다`)
      .toEqual(new Set(props))
  }
  for (const [k, v] of Object.entries(n)) assertStrictShape(v, `${path}.${k}`)
}

describe('CONTENT_JSON_SCHEMA', () => {
  it('★ strict 모드 요구사항을 만족한다', () => {
    assertStrictShape(CONTENT_JSON_SCHEMA)
  })

  it('문제는 정확히 3개다', () => {
    const q = CONTENT_JSON_SCHEMA.properties.questions
    expect(q.minItems).toBe(3)
    expect(q.maxItems).toBe(3)
  })

  it('expected_points 와 hint 가 스키마에 있다 — 서버에만 남는다', () => {
    const props = CONTENT_JSON_SCHEMA.properties.questions.items.properties
    expect(Object.keys(props)).toContain('expected_points')
    expect(Object.keys(props)).toContain('hint')
  })
})

describe('GRADE_JSON_SCHEMA', () => {
  it('★ strict 모드 요구사항을 만족한다', () => {
    assertStrictShape(GRADE_JSON_SCHEMA)
  })

  it('verdict 는 pass 또는 revise 다', () => {
    expect(GRADE_JSON_SCHEMA.properties.overall.properties.verdict.enum)
      .toEqual(['pass', 'revise'])
  })
})

const validContent = {
  passage: {
    title: 'HTTP 캐시',
    body_md: '본문',
    key_terms: [{ term: 'ETag', definition: '리소스 지문' }],
  },
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    type: 'concept',
    prompt: '설명하라',
    expected_points: ['포인트 하나'],
    hint: '힌트',
  })),
}

describe('ContentSchema', () => {
  it('정상 응답을 통과시킨다', () => {
    expect(ContentSchema.safeParse(validContent).success).toBe(true)
  })

  it('문제가 3개가 아니면 거른다', () => {
    const bad = { ...validContent, questions: validContent.questions.slice(0, 2) }
    expect(ContentSchema.safeParse(bad).success).toBe(false)
  })

  it('expected_points 가 비면 거른다 — 채점할 근거가 없다', () => {
    const bad = {
      ...validContent,
      questions: validContent.questions.map((q) => ({ ...q, expected_points: [] })),
    }
    expect(ContentSchema.safeParse(bad).success).toBe(false)
  })

  it('알 수 없는 type 을 거른다', () => {
    const bad = {
      ...validContent,
      questions: validContent.questions.map((q) => ({ ...q, type: 'multiple_choice' })),
    }
    expect(ContentSchema.safeParse(bad).success).toBe(false)
  })
})

const validGrade = {
  per_question: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    score: 67,
    correct_points: ['맞은 것'],
    missed_points: ['놓친 것'],
    misconceptions: [],
    feedback_ko: '두 문장이다. 이유도 적었다.',
  })),
  overall: { score: 67, goal_reached: false, verdict: 'revise' },
  summary_seed: ['항목 1', '항목 2', '항목 3'],
}

describe('GradeSchema', () => {
  it('정상 응답을 통과시킨다', () => {
    expect(GradeSchema.safeParse(validGrade).success).toBe(true)
  })

  it('점수가 0~100 밖이면 거른다', () => {
    const bad = { ...validGrade, overall: { ...validGrade.overall, score: 120 } }
    expect(GradeSchema.safeParse(bad).success).toBe(false)
  })

  it('summary_seed 가 비면 거른다 — 정리본 화면이 이걸 쓴다', () => {
    expect(GradeSchema.safeParse({ ...validGrade, summary_seed: [] }).success).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/llm/schemas.test.ts`
Expected: FAIL — `lib/llm/schemas` 없음

- [ ] **Step 3: 구현한다**

`lib/llm/schemas.ts`:

```ts
import { z } from 'zod'

/**
 * OpenAI Structured Outputs 의 strict 모드는 세 가지를 요구한다:
 *   - 모든 object 에 "additionalProperties": false
 *   - 모든 object 의 required 가 properties 의 모든 키를 담을 것
 *   - 따라서 선택 필드를 만들 수 없다
 *
 * hint 가 필수인 이유가 그것이다. 빈 문자열은 허용한다.
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
  // 정리본 화면이 이걸 체크리스트로 쓴다. 비면 그 화면이 빈 껍데기가 된다.
  summary_seed: z.array(z.string().min(1)).min(1),
})

export type GradeResult = z.infer<typeof GradeSchema>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/llm/schemas.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/llm/schemas.ts tests/llm/schemas.test.ts
git commit -m "feat: content·grade 의 strict JSON Schema 와 zod 검증

Structured Outputs 가 형식을 강제하지만 그건 OpenAI 쪽 디코딩의
보장이다. DB 에 넣기 전에 우리 코드로도 확인한다 — 스키마를 고쳤는데
한쪽만 고치는 실수를 zod 가 잡는다.

strict 모드는 모든 object 에 additionalProperties:false 와 모든 키를
담은 required 를 요구한다. 선택 필드를 만들 수 없어서 hint 도 필수다
(빈 문자열 허용). 그 요구사항을 재귀로 검사하는 테스트를 넣었다.

expected_points 가 비면 zod 가 거른다. 형식은 맞아도 채점할 근거가
없기 때문이다. summary_seed 도 마찬가지로 3주차 화면이 이걸 쓴다."
```

---

## Task 3: 프롬프트와 사용자 메시지 조립

**Files:**
- Create: `lib/llm/prompts.ts`
- Test: `tests/llm/prompts.test.ts`

**Interfaces:**
- Consumes: `DayEntry` (`lib/curriculum/load`), `GeneratedContent` (Task 2)
- Produces:
  - `CONTENT_SYSTEM: string`, `GRADE_SYSTEM: string`
  - `contentUserMessage(subjectLabel: string, entry: DayEntry): string`
  - `gradeUserMessage(entry: DayEntry, questions: GeneratedContent['questions'], answers: Record<string, string>): string`

시스템 프롬프트는 **스펙 §5.4 · §5.5 의 원문을 그대로** 옮긴다.
문구를 임의로 바꾸지 않는다 — 그 문장 하나하나가 설계 결정이다.

채점 메시지에는 **루브릭(`expected_points`)이 들어간다.** 이것이 채점을
재현 가능하게 만드는 핵심이다 (스펙 §5.2). 지문 전체는 넣지 않는다 —
루브릭이 이미 기준이고, 넣으면 입력 토큰만 늘어난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/llm/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CONTENT_SYSTEM, GRADE_SYSTEM, contentUserMessage, gradeUserMessage,
} from '../../lib/llm/prompts'
import { getDay } from '../../lib/curriculum/load'

const entry = getDay('cs', 1)!

describe('CONTENT_SYSTEM', () => {
  it('문제 수와 유형을 못박는다', () => {
    expect(CONTENT_SYSTEM).toContain('정확히 3개')
    expect(CONTENT_SYSTEM).toContain('recall')
    expect(CONTENT_SYSTEM).toContain('application')
  })

  it('루브릭이 판정 가능해야 한다고 못박는다', () => {
    expect(CONTENT_SYSTEM).toContain('검증 가능한 한 문장')
  })

  it('객관식을 금지한다', () => {
    expect(CONTENT_SYSTEM).toContain('객관식')
  })
})

describe('GRADE_SYSTEM', () => {
  it('★ 루브릭 밖의 기준을 금지한다 — 재현 가능한 채점의 근거다', () => {
    expect(GRADE_SYSTEM).toContain('루브릭에 없는 기준으로 채점하지 마라')
  })

  it('점수 계산식을 못박는다 — 임의 조정을 막는다', () => {
    expect(GRADE_SYSTEM).toContain('임의로 조정하지 마라')
  })

  it('칭찬으로 시작하지 말라고 한다', () => {
    expect(GRADE_SYSTEM).toContain('칭찬으로 문장을 시작하지 마라')
  })
})

describe('contentUserMessage', () => {
  it('커리큘럼 항목의 다섯 가지를 모두 담는다', () => {
    const msg = contentUserMessage('컴퓨터 과학', entry)
    expect(msg).toContain('컴퓨터 과학')
    expect(msg).toContain(String(entry.day))
    expect(msg).toContain(entry.topic)
    expect(msg).toContain(entry.goal)
    expect(msg).toContain(entry.keywords[0])
    expect(msg).toContain(String(entry.difficulty))
  })
})

describe('gradeUserMessage', () => {
  const questions = [
    { id: 'q1' as const, type: 'concept' as const, prompt: '설명하라',
      expected_points: ['포인트 A', '포인트 B'], hint: '힌트' },
  ]

  it('★ 루브릭을 담는다 — 이게 없으면 채점이 매번 달라진다', () => {
    const msg = gradeUserMessage(entry, questions, { q1: '내 답' })
    expect(msg).toContain('포인트 A')
    expect(msg).toContain('포인트 B')
  })

  it('학습자 답안을 담는다', () => {
    expect(gradeUserMessage(entry, questions, { q1: '내 답' })).toContain('내 답')
  })

  it('★ 힌트를 담지 않는다 — 채점과 무관한 토큰이다', () => {
    expect(gradeUserMessage(entry, questions, { q1: '내 답' })).not.toContain('힌트')
  })

  it('답을 안 쓴 문제는 빈 답으로 표시한다', () => {
    const msg = gradeUserMessage(entry, questions, {})
    expect(msg).toContain('(답을 쓰지 않음)')
  })

  it('goal 을 담는다 — goal_reached 판정의 근거다', () => {
    expect(gradeUserMessage(entry, questions, { q1: 'x' })).toContain(entry.goal)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/llm/prompts.test.ts`
Expected: FAIL — `lib/llm/prompts` 없음

- [ ] **Step 3: 구현한다**

`lib/llm/prompts.ts`:

```ts
import type { DayEntry } from '../curriculum/load'
import type { GeneratedContent } from './schemas'

/**
 * 시스템 프롬프트는 스펙 §5.4 · §5.5 의 원문이다.
 * 문구를 임의로 바꾸지 않는다 — 문장 하나하나가 설계 결정이다.
 * 바꾸려면 스펙을 먼저 고치고 그 이유를 DECISIONS 에 남긴다.
 */

export const CONTENT_SYSTEM = `당신은 한국인 학습자 1명을 위한 개인 교재 저자다.
주어진 커리큘럼 항목 하나로 오늘치 학습 자료를 만든다.

원칙:
- 대상은 성인 학습자 1명이다. 격려나 인사말을 쓰지 마라. 교재 본문만 쓴다.
- goal에 도달시키는 것이 유일한 목표다. goal과 무관한 곁가지 지식은 넣지 마라.
- 지문은 700~1000자. 정의 → 왜 그런가 → 구체 예시 순으로 전개한다.
  "~는 중요합니다" 같은 공허한 문장을 쓰지 마라. 매 문장이 정보를 옮겨야 한다.
- 예시는 반드시 하나 이상 넣는다. 추상적 설명만으로 끝내지 마라.
- 문제는 정확히 3개. recall 1개, concept 1개, application 1개.
  전부 서술형이며, 객관식이나 O/X를 내지 마라.
- expected_points는 채점 루브릭이다. 학습자에게 보이지 않는다.
  각 문제마다 2~4개의 채점 포인트를 쓴다. 각 포인트는 검증 가능한 한 문장이어야 한다.
  ("잘 이해함" 같은 판정 불가능한 표현 금지)
- 지문 안에 문제의 답을 그대로 노출하지 마라. 지문을 읽고 추론해야 풀리게 한다.
- 수학/CS의 수식은 KaTeX 인라인 문법으로 쓴다.`

export const GRADE_SYSTEM = `당신은 채점자다. 주어진 루브릭에 없는 기준으로 채점하지 마라.

원칙:
- 각 채점 포인트를 학습자 답안이 담고 있는지 하나씩 판정한다.
  담고 있으면 correct_points, 아니면 missed_points에 넣는다.
- 표현이 달라도 의미가 같으면 맞은 것으로 본다. 용어를 그대로 쓰지 않았다는
  이유로 감점하지 마라. 반대로, 용어만 나열하고 관계를 설명하지 못했으면 틀린 것이다.
- 점수는 (맞은 포인트 수 / 전체 포인트 수) × 100 을 반올림한 값이다. 임의로 조정하지 마라.
- feedback_ko는 2~4문장. 무엇이 빠졌는지와 왜 그게 필요한지를 쓴다.
  칭찬으로 문장을 시작하지 마라. 틀린 곳을 먼저 말한다.
- 학습자가 사실과 다른 내용을 썼다면 misconceptions에 명시적으로 적는다.
- summary_seed는 학습자가 최종 정리본을 쓸 때의 뼈대다.
  학습자가 실제로 이해한 것과 놓친 것을 반영해 3~5개 항목으로 만든다.
  정리본을 대신 써주지 마라. 항목만 준다.`

export function contentUserMessage(subjectLabel: string, entry: DayEntry): string {
  return [
    `과목: ${subjectLabel}`,
    `Day: ${entry.day}`,
    `주제: ${entry.topic}`,
    `목표(goal): ${entry.goal}`,
    `키워드: ${entry.keywords.join(', ')}`,
    `난이도: ${entry.difficulty} / 5`,
  ].join('\n')
}

/**
 * 채점 메시지.
 *
 * ★ 루브릭(expected_points)이 들어가는 것이 핵심이다. 이게 없으면 모델이
 * 매번 기준을 새로 지어내고, 같은 답에 어제는 80점 오늘은 55점이 나온다.
 *
 * 지문 본문은 넣지 않는다. 루브릭이 이미 기준이므로 넣어봤자 입력 토큰만
 * 늘어난다. 힌트도 넣지 않는다 — 채점과 무관하다.
 */
export function gradeUserMessage(
  entry: DayEntry,
  questions: GeneratedContent['questions'],
  answers: Record<string, string>,
): string {
  const blocks = questions.map((q) => [
    `[${q.id}] ${q.prompt}`,
    `채점 포인트:`,
    ...q.expected_points.map((p, i) => `  ${i + 1}. ${p}`),
    `학습자 답안:`,
    `  ${answers[q.id]?.trim() || '(답을 쓰지 않음)'}`,
  ].join('\n'))

  return [
    `주제: ${entry.topic}`,
    `목표(goal): ${entry.goal}`,
    '',
    ...blocks,
  ].join('\n\n')
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/llm/prompts.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/llm/prompts.ts tests/llm/prompts.test.ts
git commit -m "feat: 시스템 프롬프트와 사용자 메시지 조립

스펙 §5.4·§5.5 의 원문을 그대로 옮겼다. 문구를 임의로 바꾸지 않는다 —
문장 하나하나가 설계 결정이다. 테스트가 핵심 문장의 존재를 못박는다.

채점 메시지에 루브릭이 들어간다. 이게 재현 가능한 채점의 근거다.
지문 본문과 힌트는 넣지 않는다 — 루브릭이 이미 기준이므로 입력 토큰만
늘어난다."
```

---

## Task 4: OpenAI 클라이언트 — **여기서부터 돈이 나간다**

**Files:**
- Create: `lib/llm/client.ts`
- Modify: `lib/llm/types.ts`
- Modify: `tests/no-real-llm.test.ts` → **파일명을 `tests/api-key-boundary.test.ts` 로 바꾼다**
- Modify: `.env.example`
- Test: `tests/llm/client.test.ts`

**Interfaces:**
- Consumes: `MODEL`, `costMicros` (Task 1); `LlmRequest`, `LlmResult` (`lib/llm/types`)
- Produces: `class OpenAiLlmClient implements LlmClient`

### ★ 시작 전 확인 (사람이 직접)

- [ ] **Step 0: 하드 리밋이 걸려 있는지 눈으로 확인한다**

https://platform.openai.com → Settings

1. 선불 잔액이 남아 있다
2. **자동 충전(auto recharge)이 꺼져 있다** ← 이게 켜져 있으면 여기서 멈춘다
3. Organization spend limit $5, 알림 $3.50

`.env.local` 에 `APP_ENV=local` 인지 확인한다 (일일 캡 3회).

### `tests/no-real-llm.test.ts` 를 지우지 않는다

1주차의 그 파일은 "LLM 을 아예 연결하지 않았다"를 강제했다. 이제 연결하므로
그 형태로는 유지할 수 없다. **그러나 지우면 안 된다** — `CLAUDE.md` 에
살아 있는 규칙이 하나 있기 때문이다:

> `lib/llm/client.ts` 밖에서 `OPENAI_API_KEY` 를 읽지 않는다. 이 파일이 유일한 소비처다.

파일을 **바꾼다.** "LLM 금지" → "API 키의 경계 감시".

- [ ] **Step 1: 경계 감시 테스트로 바꾼다**

`git mv tests/no-real-llm.test.ts tests/api-key-boundary.test.ts` 후 내용을 교체:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * `OPENAI_API_KEY` 는 lib/llm/client.ts 한 곳에서만 읽는다 (CLAUDE.md).
 *
 * 1주차에는 이 파일이 "LLM 을 아예 연결하지 않았다"를 강제했다. 2주차에
 * 연결하면서 감시 대상을 바꿨다 — 키가 새는 경로를 막는 쪽으로.
 *
 * 키가 여러 곳에서 읽히면 어디서 새는지 추적할 수 없고, 클라이언트
 * 컴포넌트에 잘못 import 되면 번들에 실린다. 한 곳으로 좁히면
 * 그 파일 하나만 보면 된다.
 */
const KEY_READ = /process\.env\.OPENAI_API_KEY/
const ALLOWED = 'lib/llm/client.ts'

const SCAN_DIRS = ['app', 'components', 'lib']
const EXT = /\.(ts|tsx|js|jsx|mjs)$/

function scan(root: string) {
  const hits: string[] = []
  for (const dirName of SCAN_DIRS) {
    const dir = join(root, dirName)
    if (existsSync(dir)) walk(dir)
  }
  return hits

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!EXT.test(name)) continue
      if (KEY_READ.test(readFileSync(full, 'utf8'))) {
        hits.push(relative(root, full).replaceAll('\\', '/'))
      }
    }
  }
}

describe('API 키의 경계', () => {
  it('★ OPENAI_API_KEY 는 lib/llm/client.ts 에서만 읽는다', () => {
    const hits = scan(process.cwd())
    expect(hits.sort(), `키를 읽는 파일: ${hits.join(', ')}`).toEqual([ALLOWED])
  })

  it('openai 패키지를 의존성에 넣지 않는다 — fetch 로 직접 부른다', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
      .not.toContain('openai')
  })

  it('FakeLlmClient 가 남아 있다 — 모든 통합 테스트가 이걸 주입한다', async () => {
    const fake = await import('../lib/llm/fake')
    expect(Object.keys(fake).sort()).toEqual(['FailingLlmClient', 'FakeLlmClient'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/api-key-boundary.test.ts`
Expected: FAIL — 첫 테스트가 `[]` 를 받는다 (`lib/llm/client.ts` 가 아직 없다)

- [ ] **Step 3: `LlmClient` 인터페이스에 스키마를 넣는다**

`lib/llm/types.ts` 의 `LlmRequest` 에 `jsonSchema` 를 추가한다.
`FakeLlmClient` 는 이 필드를 무시하므로 기존 테스트는 그대로 통과한다.

```ts
export interface LlmRequest {
  route: string
  system: string
  user: string
  schemaName: string
  /** OpenAI Structured Outputs 에 보낼 strict JSON Schema */
  jsonSchema: object
  maxTokens: number
  temperature: number
}
```

- [ ] **Step 4: 클라이언트 테스트를 쓴다 (실제 호출 없음 — fetch 스텁)**

`tests/llm/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenAiLlmClient } from '../../lib/llm/client'

const okBody = (content: object, usage = { prompt_tokens: 100, completion_tokens: 200 }) => ({
  choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
  usage,
})

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch))
}

const req = {
  route: 'content',
  system: '시스템',
  user: '사용자',
  schemaName: 'study_content',
  jsonSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  maxTokens: 2000,
  temperature: 0.6,
}

beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'sk-test-key') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('OpenAiLlmClient', () => {
  it('요청 본문에 strict json_schema 를 담는다', async () => {
    let sent: Record<string, unknown> = {}
    stubFetch(async (_url, init) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)

    expect(sent.model).toBe('gpt-4o-mini')
    expect(sent.temperature).toBe(0.6)
    expect(sent.max_tokens).toBe(2000)
    const rf = sent.response_format as { type: string; json_schema: { strict: boolean; name: string } }
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema.strict).toBe(true)
    expect(rf.json_schema.name).toBe('study_content')
  })

  it('★ API 키를 Authorization 헤더로만 보낸다 — URL 에 넣지 않는다', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    stubFetch(async (u, init) => {
      url = u
      headers = init.headers as Record<string, string>
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })

    await new OpenAiLlmClient().generate(req)

    expect(url).not.toContain('sk-test-key')
    expect(headers.Authorization).toBe('Bearer sk-test-key')
  })

  it('토큰 수와 비용을 함께 준다', async () => {
    stubFetch(async () => new Response(
      JSON.stringify(okBody({ ok: true }, { prompt_tokens: 500, completion_tokens: 2000 })),
      { status: 200 },
    ))

    const r = await new OpenAiLlmClient().generate(req)
    expect(r.promptTokens).toBe(500)
    expect(r.completionTokens).toBe(2000)
    expect(r.costMicros).toBe(1275) // costMicros(500, 2000)
  })

  it('파싱한 데이터를 준다', async () => {
    stubFetch(async () => new Response(
      JSON.stringify(okBody({ passage: { title: '제목' } })), { status: 200 },
    ))
    const r = await new OpenAiLlmClient().generate<{ passage: { title: string } }>(req)
    expect(r.data.passage.title).toBe('제목')
  })

  it('★ 키가 없으면 호출하지 않고 던진다', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/OPENAI_API_KEY/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('HTTP 오류를 던진다 — 상태 코드를 메시지에 담는다', async () => {
    stubFetch(async () => new Response('rate limited', { status: 429 }))
    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/429/)
  })

  it('★ 오류 메시지에 API 키가 섞이지 않는다', async () => {
    stubFetch(async () => new Response('bad key sk-test-key leaked', { status: 401 }))
    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(
      expect.not.stringContaining('sk-test-key') as unknown as string,
    ).catch((e: Error) => {
      expect(e.message).not.toContain('sk-test-key')
    })
  })

  it('★ 잘린 응답(length)을 던진다 — 반쪽 JSON 을 DB 에 넣지 않는다', async () => {
    stubFetch(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }), { status: 200 }))

    await expect(new OpenAiLlmClient().generate(req)).rejects.toThrow(/max_tokens|잘렸/)
  })

  it('타임아웃 시그널을 붙인다', async () => {
    let hasSignal = false
    stubFetch(async (_u, init) => {
      hasSignal = init.signal instanceof AbortSignal
      return new Response(JSON.stringify(okBody({ ok: true })), { status: 200 })
    })
    await new OpenAiLlmClient().generate(req)
    expect(hasSignal).toBe(true)
  })
})
```

- [ ] **Step 5: 구현한다**

`lib/llm/client.ts`:

```ts
import { MODEL, costMicros } from './pricing'
import type { LlmClient, LlmRequest, LlmResult } from './types'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const TIMEOUT_MS = 30_000

/**
 * ★ 이 파일이 OPENAI_API_KEY 의 유일한 소비처다 (CLAUDE.md).
 * tests/api-key-boundary.test.ts 가 그것을 강제한다.
 *
 * openai 패키지를 쓰지 않고 fetch 로 직접 부른다:
 *   - 의존성이 늘지 않고 버셀 번들이 가볍다
 *   - AbortSignal.timeout 을 완전히 제어한다
 *   - Structured Outputs 는 JSON 바디 하나라 SDK 가 필요 없다
 */
export class OpenAiLlmClient implements LlmClient {
  async generate<T>(req: LlmRequest): Promise<LlmResult<T>> {
    const key = process.env.OPENAI_API_KEY
    // 키가 없으면 네트워크를 때리지 않는다. 401 을 받아보고 알 이유가 없다.
    if (!key) throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다')

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        // 키는 헤더로만 간다. URL 에 넣으면 로그와 프록시에 남는다.
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: req.temperature,
        max_tokens: req.maxTokens, // 무제한 금지 — 비용 게이트다
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: req.schemaName,
            strict: true,
            schema: req.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      // 응답 본문을 메시지에 넣지 않는다. 키가 에코되어 돌아올 수 있고
      // 그러면 로그에 키가 남는다. 상태 코드만으로 충분히 진단된다.
      throw new Error(`OpenAI 호출 실패: HTTP ${res.status}`)
    }

    const body = await res.json()
    const choice = body.choices?.[0]

    // 잘린 응답은 형식이 맞아 보여도 반쪽이다. DB 에 넣으면 그 Day 는
    // 평생 UNIQUE 제약에 묶여 되살릴 수 없다. 여기서 막는다.
    if (choice?.finish_reason === 'length') {
      throw new Error('응답이 max_tokens 에서 잘렸습니다')
    }

    const promptTokens = body.usage?.prompt_tokens ?? 0
    const completionTokens = body.usage?.completion_tokens ?? 0

    return {
      data: JSON.parse(choice.message.content) as T,
      promptTokens,
      completionTokens,
      costMicros: costMicros(promptTokens, completionTokens),
    }
  }
}
```

- [ ] **Step 6: `.env.example` 에 키 항목을 넣는다**

```
# 2주차부터 필요하다. lib/llm/client.ts 에서만 읽힌다.
# 넣기 전에 OpenAI 대시보드의 자동 충전이 꺼져 있는지 확인할 것.
OPENAI_API_KEY=
```

- [ ] **Step 7: 통과를 확인한다**

```bash
npx vitest run tests/llm/client.test.ts tests/api-key-boundary.test.ts
npm test
npx tsc --noEmit
npm run check:secrets
```

Expected: 전부 성공. `api-key-boundary` 의 첫 테스트가 `['lib/llm/client.ts']` 를 본다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: OpenAI 클라이언트 — Structured Outputs

openai 패키지를 쓰지 않고 fetch 로 직접 부른다. 의존성이 늘지 않고
AbortSignal.timeout 을 완전히 제어할 수 있으며 버셀 번들이 가볍다.

tests/no-real-llm.test.ts 를 지우지 않고 tests/api-key-boundary.test.ts
로 바꿨다. 1주차에는 'LLM 을 아예 연결하지 않았다'를 지켰지만, 이제는
'OPENAI_API_KEY 는 lib/llm/client.ts 한 곳에서만 읽힌다'를 지킨다.
그건 CLAUDE.md 의 살아 있는 규칙이라 구조적 감시를 계속 둘 가치가 있다.

키를 다루는 규칙 셋을 테스트로 박았다:
- 키가 없으면 네트워크를 때리지 않고 던진다
- 키는 Authorization 헤더로만 간다 (URL 에 넣으면 로그에 남는다)
- 오류 메시지에 응답 본문을 넣지 않는다 (키가 에코될 수 있다)

finish_reason 이 length 면 던진다. 잘린 응답을 저장하면 그 Day 는
UNIQUE 제약에 묶여 평생 되살릴 수 없다."
```

---

## Task 5: content 라우트를 진짜 클라이언트로 — **첫 실호출**

**Files:**
- Modify: `lib/study/content.ts`
- Modify: `app/api/study/[subject]/content/route.ts`
- Test: `tests/integration/content-route.test.ts` (기존 16개가 계속 통과해야 한다)

**Interfaces:**
- Consumes: `CONTENT_SYSTEM`, `contentUserMessage` (Task 3); `CONTENT_JSON_SCHEMA`,
  `ContentSchema` (Task 2); `OpenAiLlmClient` (Task 4); `MODEL` (Task 1)
- Produces: 없음 (기존 `ContentOutcome` 계약 유지)

**핵심:** `lib/study/content.ts` 의 **순서를 바꾸지 않는다.**
커리큘럼 확인 → 캐시 → 당일 중복 → 예산 예약 → LLM 호출. 그 순서가 4겹이다.
바꾸는 것은 프롬프트·스키마·모델명, 그리고 응답 검증 한 겹뿐이다.

**새로 넣는 것:** LLM 응답을 `ContentSchema.safeParse` 로 한 번 더 본다.
실패하면 던진다 → 기존 catch 가 예산을 롤백하고 원장에 실패로 남긴다.
**형식이 깨진 콘텐츠를 저장하면 그 Day 는 UNIQUE 제약에 묶여 평생 되살릴 수 없다.**

- [ ] **Step 1: 검증 실패 경로의 테스트를 추가한다**

`tests/integration/content-route.test.ts` 끝에 추가:

```ts
describe('응답 검증', () => {
  it('★ 스키마에 안 맞는 응답은 저장하지 않는다 — Day 가 평생 망가진다', async () => {
    // 문제가 2개뿐인 응답
    const broken = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [
        { id: 'q1', type: 'recall', prompt: '문제', expected_points: ['포인트'], hint: '' },
        { id: 'q2', type: 'concept', prompt: '문제', expected_points: ['포인트'], hint: '' },
      ],
    })

    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('루브릭이 빈 응답도 막는다 — 채점할 근거가 없다', async () => {
    const noRubric = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [1, 2, 3].map((i) => ({
        id: `q${i}`, type: 'concept', prompt: '문제', expected_points: [], hint: '',
      })),
    })

    await expect(getOrCreateContent({ db, clock, llm: noRubric }, 'cs', 1)).rejects.toThrow()
    expect(await db.select().from(studyDays)).toHaveLength(0)
  })

  it('검증 실패도 예산을 되돌린다', async () => {
    const broken = new FakeLlmClient({ passage: {}, questions: [] })
    await expect(getOrCreateContent({ db, clock, llm: broken }, 'cs', 1)).rejects.toThrow()

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/integration/content-route.test.ts`
Expected: 새 테스트 3개 FAIL — 아직 zod 검증이 없어 깨진 응답이 저장된다

- [ ] **Step 3: `lib/study/content.ts` 를 고친다**

import 를 추가한다:

```ts
import { loadCurriculum } from '../curriculum/load'
import { CONTENT_JSON_SCHEMA, ContentSchema } from '../llm/schemas'
import { CONTENT_SYSTEM, contentUserMessage } from '../llm/prompts'
import { MODEL } from '../llm/pricing'
```

`llm.generate` 호출부와 그 뒤를 교체한다. **위쪽 4겹은 손대지 않는다.**

```ts
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
    // 여기서 통과한 것만 DB 에 들어간다 — 한 번 들어가면 UNIQUE 제약 때문에
    // 그 Day 는 평생 그 내용이다.
    const parsed = ContentSchema.safeParse(result.data)
    if (!parsed.success) {
      throw new Error(`콘텐츠 형식이 스키마와 다릅니다: ${parsed.error.issues[0]?.message}`)
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
```

**주의:** `recordUsage` 의 `model` 이 `'fake'` 에서 `MODEL` 로 바뀐다.
1주차 완료 기준이 "원장의 model 이 전부 fake" 였다. 이제 실제 값이 쌓인다 —
그 전환 자체가 "돈이 나가기 시작했다"의 기록이다.

- [ ] **Step 4: 라우트에서 클라이언트를 교체한다**

`app/api/study/[subject]/content/route.ts`:

```ts
import { OpenAiLlmClient } from '@/lib/llm/client'

const llm = new OpenAiLlmClient()
```

`FakeLlmClient` import 와 「1주차에는 가짜 클라이언트만 존재한다」 주석을 지운다.

- [ ] **Step 5: 통과를 확인한다**

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: 전부 성공 (기존 16개 + 새 3개).

- [ ] **Step 6: ★ 첫 실호출을 손으로 한다**

`.env.local` 에 `OPENAI_API_KEY` 를 넣고 `npm run dev`.

브라우저에서 로그인한 뒤 개발자도구 → Application → Cookies 에서 `sid` 값을 복사한다.

```bash
curl -s -X POST http://localhost:3000/api/study/cs/content \
  -H 'content-type: application/json' \
  -H "cookie: sid=PASTE_HERE" \
  -d '{"dayNo":1}' | head -c 900
```

확인할 것:

- `passage.body_md` 에 700~1000자의 한글 지문이 있다
- `questions` 가 3개이고 `id` 가 `q1`/`q2`/`q3` 이다
- **응답에 `expected_points` 와 `hint` 가 없다** ← 루브릭 유출 방지가 실제로 동작한다

DB 와 원장을 본다 (`scripts/peek.mjs` 로 저장해두면 이후에도 쓴다):

```js
process.loadEnvFile('.env.local')
const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

const [day] = await sql`SELECT content FROM study_days WHERE subject='cs' AND day_no=1`
console.log('루브릭이 DB 에 있나:', JSON.stringify(day.content).includes('expected_points'))

console.table(await sql`
  SELECT route, model, prompt_tokens, completion_tokens, cost_micros, ok
  FROM usage_ledger ORDER BY id`)
console.table(await sql`SELECT period_key, calls, cost_micros FROM budget_counters`)
```

- `usage_ledger` 에 `model='gpt-4o-mini'` 인 행이 **하나** 생겼다
- `cost_micros` 가 1,000~3,000 사이다 (≈ $0.001~0.003)

**★ 같은 요청을 한 번 더 보낸다.** `usage_ledger` 행이 **늘지 않아야** 한다.
멱등성이 실제 돈 앞에서 동작하는 것을 보는 순간이다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: content 라우트를 실제 OpenAI 로 교체

4겹의 순서는 그대로 둔다 — 커리큘럼 확인 → 캐시 → 당일 중복 →
예산 예약 → LLM 호출. 바뀐 것은 프롬프트·스키마·모델명, 그리고
응답 검증 한 겹뿐이다.

LLM 응답을 ContentSchema 로 한 번 더 본다. 형식이 깨진 콘텐츠를
저장하면 그 Day 는 UNIQUE 제약에 묶여 평생 되살릴 수 없다. 검증
실패는 기존 catch 로 들어가 예산을 되돌리고 원장에 실패로 남는다.

usage_ledger 의 model 이 'fake' 에서 'gpt-4o-mini' 로 바뀐다.
그 전환이 곧 '돈이 나가기 시작했다'의 기록이다."
```

---

## Task 6: 답안 초안 보관

**Files:**
- Create: `lib/study/draft.ts`
- Test: `tests/study/draft.test.ts`

**Interfaces:**
- Produces: `type Answers = Record<string, string>`,
  `draftKey(subject, dayNo)`, `loadDraft(subject, dayNo): Answers`,
  `saveDraft(subject, dayNo, answers): void`, `clearDraft(subject, dayNo): void`

### ★ 1주차에 한 약속을 여기서 지킨다

`SessionBar` 의 `expiringNote` 는 지금 비어 있다. 만료 30초 경고가
**"쓰던 답은 브라우저에 남는다"** 고 말하려면 그게 사실이어야 한다.
학습 화면(Task 7)이 이 모듈을 쓰고 그 문장을 넘긴다.
**동작과 문구가 같은 PR 에 들어간다 — 문구만 넣으면 거짓말이다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/study/draft.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { draftKey, loadDraft, saveDraft, clearDraft } from '../../lib/study/draft'

/** localStorage 를 흉내낸다. 접근 자체가 던지는 환경도 만든다. */
function fakeStorage(throwOnAccess = false) {
  const map = new Map<string, string>()
  const guard = () => { if (throwOnAccess) throw new Error('blocked') }
  return {
    getItem: (k: string) => { guard(); return map.get(k) ?? null },
    setItem: (k: string, v: string) => { guard(); map.set(k, v) },
    removeItem: (k: string) => { guard(); map.delete(k) },
  }
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('draftKey', () => {
  it('과목과 Day 로 키를 나눈다 — 초안이 섞이지 않는다', () => {
    expect(draftKey('cs', 5)).not.toBe(draftKey('math', 5))
    expect(draftKey('cs', 5)).not.toBe(draftKey('cs', 6))
  })
})

describe('초안 보관', () => {
  it('저장한 것을 그대로 돌려준다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveDraft('cs', 1, { q1: '답 하나', q2: '', q3: '' })
    expect(loadDraft('cs', 1)).toEqual({ q1: '답 하나', q2: '', q3: '' })
  })

  it('없으면 빈 객체다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadDraft('cs', 1)).toEqual({})
  })

  it('지우면 사라진다', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveDraft('cs', 1, { q1: '답' })
    clearDraft('cs', 1)
    expect(loadDraft('cs', 1)).toEqual({})
  })

  it('★ localStorage 가 막힌 환경에서도 던지지 않는다', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => saveDraft('cs', 1, { q1: '답' })).not.toThrow()
    expect(loadDraft('cs', 1)).toEqual({})
    expect(() => clearDraft('cs', 1)).not.toThrow()
  })

  it('망가진 JSON 이 들어 있어도 빈 객체를 준다', () => {
    const s = fakeStorage()
    s.setItem(draftKey('cs', 1), '{깨진')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('cs', 1)).toEqual({})
  })

  it('배열이 들어 있어도 빈 객체를 준다', () => {
    const s = fakeStorage()
    s.setItem(draftKey('cs', 1), '[1,2,3]')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('cs', 1)).toEqual({})
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/study/draft.test.ts`
Expected: FAIL — `lib/study/draft` 없음

- [ ] **Step 3: 구현한다**

`lib/study/draft.ts`:

```ts
/**
 * 답안 초안을 브라우저에 남긴다.
 *
 * 세션이 닫혀도 쓰던 답을 잃지 않게 하는 것이 목적이다. 세션 바의 만료
 * 경고가 "쓰던 답은 브라우저에 남는다"고 말하는 근거가 이 파일이다.
 * 이게 없으면 그 문장은 거짓말이다.
 *
 * localStorage 접근 자체가 던지는 환경이 있다(사생활 보호 모드, 사이트
 * 데이터 차단). 초안은 편의 기능이므로 실패해도 화면이 죽으면 안 된다 —
 * 전부 삼키고 빈 값을 준다.
 */
export type Answers = Record<string, string>

export function draftKey(subject: string, dayNo: number): string {
  return `study-page:draft:${subject}:${dayNo}`
}

export function loadDraft(subject: string, dayNo: number): Answers {
  try {
    const raw = localStorage.getItem(draftKey(subject, dayNo))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    // 배열도 typeof 'object' 다. 객체만 받는다.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Answers
  } catch {
    return {}
  }
}

export function saveDraft(subject: string, dayNo: number, answers: Answers): void {
  try {
    localStorage.setItem(draftKey(subject, dayNo), JSON.stringify(answers))
  } catch {
    // 저장 못 해도 화면은 계속 돈다
  }
}

export function clearDraft(subject: string, dayNo: number): void {
  try {
    localStorage.removeItem(draftKey(subject, dayNo))
  } catch {
    // 무시
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/study/draft.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/study/draft.ts tests/study/draft.test.ts
git commit -m "feat: 답안 초안을 브라우저에 남긴다

세션 바의 만료 경고가 '쓰던 답은 브라우저에 남는다'고 말하려면
그게 사실이어야 한다. 이 모듈이 그 근거다.

localStorage 접근 자체가 던지는 환경이 있다(사생활 보호 모드,
사이트 데이터 차단). 초안은 편의 기능이므로 실패해도 화면이 죽으면
안 된다 — 전부 삼키고 빈 값을 준다. 그 경로를 테스트로 박았다.

배열도 typeof 'object' 라서 Array.isArray 로 한 번 더 거른다."
```

---

## Task 7: 학습 화면

**Files:**
- Create: `app/study/[subject]/page.tsx`
- Create: `components/Passage.tsx`
- Create: `components/AnswerForm.tsx`
- Modify: `app/page.tsx` (「시작하기」를 링크로, 2주차 안내 문구 삭제)
- Modify: `package.json` (의존성 4개)

**Interfaces:**
- Consumes: `loadProgress` (`lib/study/progress`), `loadDraft`/`saveDraft`/`clearDraft` (Task 6),
  `SessionBar` (`expiringNote` prop)
- Produces: `POST /api/study/[subject]/grade` 로 `{ dayNo, answers }` 를 보낸다

디자인은 캔버스의 **3번 아트보드**다. 색·글꼴은 `app/globals.css` 의
`@theme` 토큰만 쓴다. **새 색을 짓지 않는다.**

- [ ] **Step 1: 의존성을 넣는다**

```bash
npm i react-markdown remark-math rehype-katex katex
```

`openai` 는 넣지 않는다 (`tests/api-key-boundary.test.ts` 가 막는다).

- [ ] **Step 2: 지문 렌더 컴포넌트를 만든다**

`components/Passage.tsx`:

```tsx
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export interface PassageProps {
  title: string
  bodyMd: string
  keyTerms: Array<{ term: string; definition: string }>
}

/**
 * LLM 이 만든 마크다운을 그린다.
 *
 * ★ rehype-raw 를 넣지 않는다. react-markdown 은 기본값에서 원시 HTML 을
 * 렌더하지 않으므로, 모델이 <script> 를 뱉어도 텍스트로 남는다.
 * 신뢰할 수 없는 출력을 그리는 화면에서 이 성질이 핵심이다.
 */
export function Passage({ title, bodyMd, keyTerms }: PassageProps) {
  return (
    <article className="mt-11 flex flex-col gap-5 rounded-card border border-rule bg-surface px-[34px] py-9">
      <h2 className="font-serif text-[26px] leading-snug text-ink">{title}</h2>

      <div className="flex flex-col gap-5 text-[17px] leading-[1.8] text-body [&_code]:rounded-sm [&_code]:bg-chip [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[15px] [&_strong]:font-semibold [&_strong]:text-ink">
        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {bodyMd}
        </Markdown>
      </div>

      {keyTerms.length > 0 && (
        <>
          <div className="h-px bg-rule-soft" />
          <dl className="flex flex-col gap-2.5">
            {keyTerms.map((t) => (
              <div key={t.term} className="flex gap-3 text-[14px] leading-[1.7]">
                <dt className="w-28 shrink-0 font-mono text-[13px] text-muted">{t.term}</dt>
                <dd className="text-body">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </article>
  )
}
```

- [ ] **Step 3: 답안 폼을 만든다**

`components/AnswerForm.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearDraft, loadDraft, saveDraft, type Answers } from '@/lib/study/draft'

export interface Question {
  id: string
  type: string
  prompt: string
}

export interface AnswerFormProps {
  subject: string
  dayNo: number
  questions: Question[]
  attemptsLeft: number
}

const TYPE_LABEL: Record<string, string> = {
  recall: '기억', concept: '개념', application: '적용',
}

export function AnswerForm({ subject, dayNo, questions, attemptsLeft }: AnswerFormProps) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Answers>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 초안은 마운트 후에 읽는다. 서버 렌더에는 localStorage 가 없다.
  useEffect(() => { setAnswers(loadDraft(subject, dayNo)) }, [subject, dayNo])

  function update(id: string, value: string) {
    const next = { ...answers, [id]: value }
    setAnswers(next)
    saveDraft(subject, dayNo, next)
  }

  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0)

  async function submit() {
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/study/${subject}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayNo, answers }),
    })

    if (res.ok) {
      // 채점까지 갔으면 초안의 역할이 끝났다. attempts 행이 원본이다.
      clearDraft(subject, dayNo)
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'CAP_EXCEEDED' ? '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.'
      : body.error === 'ATTEMPT_CAP' ? '채점은 하루 2회까지다.'
      : '채점에 실패했다. 답은 그대로 남아 있으니 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-14 flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-ink">문제</h2>
        <span className="font-mono text-[11.5px] tracking-[0.1em] text-faint">서술형 3문항</span>
      </div>

      <div className="mt-6 flex flex-col gap-8">
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-3">
            <div className="flex gap-3.5">
              <span className="shrink-0 pt-1 font-mono text-[13px] text-faint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] tracking-[0.1em] text-faint">
                  {TYPE_LABEL[q.type] ?? q.type}
                </span>
                <p className="font-serif text-[19px] leading-relaxed text-ink">{q.prompt}</p>
              </div>
            </div>
            <textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => update(q.id, e.target.value)}
              rows={4}
              placeholder="여기에 답을 쓴다."
              className="rounded-card border border-rule bg-surface px-[18px] py-4 text-[15.5px] leading-[1.8] text-body outline-none placeholder:text-ghost focus:border-ink"
            />
            <div className="flex justify-end">
              <span className="font-mono text-[11px] text-ghost">
                {(answers[q.id] ?? '').length}자
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 h-px bg-rule" />

      {error && <p className="mt-4 text-[13px] leading-relaxed text-stop">{error}</p>}

      <div className="mt-5 flex items-center justify-between gap-6">
        <span className="text-[13px] leading-[1.7] text-faint">
          채점은 하루 2회까지. 남은 횟수{' '}
          <span className="font-mono text-body">{attemptsLeft}</span>
        </span>
        <button
          onClick={submit}
          disabled={busy || !allAnswered || attemptsLeft === 0}
          className="h-12 cursor-pointer rounded-control bg-ink px-7 text-[15px] font-medium text-paper disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? '채점 중…' : '제출하고 채점받기'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 학습 페이지를 만든다**

`app/study/[subject]/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { SUBJECTS, getDay, loadCurriculum, type Subject } from '@/lib/curriculum/load'
import { loadProgress } from '@/lib/study/progress'
import { attempts, studyDays } from '@/lib/db/schema'
import { SessionBar } from '@/components/SessionBar'
import { Passage } from '@/components/Passage'
import { AnswerForm } from '@/components/AnswerForm'

export const dynamic = 'force-dynamic'

/** attempts 의 CHECK 제약과 같은 값. 화면은 이걸 표시만 하고 강제는 DB 가 한다. */
const ATTEMPT_CAP = 2

export default async function StudyPage({ params }: PageProps<'/study/[subject]'>) {
  // Next 16 에서 params 는 Promise 다.
  const { subject } = await params
  if (!(SUBJECTS as readonly string[]).includes(subject)) notFound()

  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const progress = (await loadProgress(db, systemClock)).find((p) => p.subject === subject)!
  const entry = getDay(subject as Subject, progress.dayNo)
  if (!entry) redirect('/') // 커리큘럼 완주

  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, progress.dayNo)))
  // 아직 콘텐츠가 없으면 대시보드로. 생성은 대시보드의 「시작하기」가 한다 (Task 11).
  if (!day) redirect('/')

  const tries = await db.select().from(attempts).where(eq(attempts.studyDayId, day.id))
  const graded = tries
    .filter((t) => t.feedback !== null)
    .sort((a, b) => b.attemptNo - a.attemptNo)[0]

  const content = day.content as {
    passage: { title: string; body_md: string; key_terms: Array<{ term: string; definition: string }> }
    questions: Array<{ id: string; type: string; prompt: string }>
  }
  const label = loadCurriculum(subject as Subject).label

  return (
    <>
      <SessionBar
        label={`${label} · DAY ${progress.dayNo}`}
        expiringNote="쓰던 답은 브라우저에 남는다. 다시 들어오면 이어서 쓸 수 있다."
      />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-8 pt-14 pb-14">
        <div className="font-mono text-xs tracking-[0.14em] text-faint">
          {label} · DAY {progress.dayNo}
        </div>
        <h1 className="mt-3.5 font-serif text-4xl leading-snug text-ink">{entry.topic}</h1>
        <p className="mt-3.5 border-l-2 border-rule-strong pl-3.5 text-[14.5px] leading-[1.7] text-muted">
          {entry.goal}
        </p>

        <Passage
          title={content.passage.title}
          bodyMd={content.passage.body_md}
          keyTerms={content.passage.key_terms}
        />

        {graded ? (
          <p className="mt-14 text-[14.5px] leading-[1.7] text-muted">
            채점 결과는 Task 9 에서 붙인다.
          </p>
        ) : (
          <AnswerForm
            subject={subject}
            dayNo={progress.dayNo}
            questions={content.questions}
            attemptsLeft={ATTEMPT_CAP - tries.length}
          />
        )}
      </main>
    </>
  )
}
```

**주의:** 채점 결과 자리는 Task 9 에서 `GradeResult` 로 교체한다.
여기서 미리 import 하면 존재하지 않는 파일을 참조해 빌드가 깨진다.

- [ ] **Step 5: 대시보드의 버튼을 링크로 바꾼다**

`app/page.tsx` 에서 비활성 `<button>` 을 `<Link>` 로 교체하고,
「학습 화면은 2주차에 붙는다」 줄을 지운다.

```tsx
import Link from 'next/link'
```

```tsx
      <Link
        href={`/study/${p.subject}`}
        className="mt-3.5 flex h-10 items-center justify-center rounded-control bg-ink text-sm font-medium text-paper hover:bg-body"
      >
        {p.today === 'completed' ? '다시 보기' : p.today === 'in_progress' ? '이어서 하기' : '시작하기'}
      </Link>
```

- [ ] **Step 6: 검증한다**

```bash
npm test && npx tsc --noEmit && npm run check:secrets && npm run build
```

`npm run dev` 로 띄우고 Task 5 에서 만든 CS Day 1 을 연다:
지문이 그려지고, 문제 3개의 입력란이 있고, 타이핑하면 글자 수가 늘고,
**새로고침해도 쓰던 답이 남아 있어야 한다.**

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 학습 화면 — 지문과 서술형 3문제

디자인 캔버스 3번 아트보드를 구현했다. 색·글꼴은 globals.css 의
@theme 토큰만 쓴다.

★ 1주차에 한 약속을 지킨다. SessionBar 의 expiringNote 가 비어
있었는데, 학습 화면은 쓰던 답이 있는 유일한 화면이므로 여기서
초안 보관을 붙이고 그 문장을 넘긴다. 동작과 문구가 같은 PR 에 들어간다.

react-markdown 에 rehype-raw 를 넣지 않는다. 기본값에서 원시 HTML 을
렌더하지 않으므로 모델이 <script> 를 뱉어도 텍스트로 남는다.
신뢰할 수 없는 출력을 그리는 화면에서 이 성질이 핵심이다."
```

---

## Task 8: 채점 오케스트레이션

**Files:**
- Create: `lib/study/grade.ts`
- Test: `tests/integration/grade.test.ts`

**Interfaces:**
- Consumes: `reserve`/`rollback`/`recordUsage` (`lib/budget/reserve`),
  `GRADE_JSON_SCHEMA`/`GradeSchema` (Task 2), `GRADE_SYSTEM`/`gradeUserMessage` (Task 3),
  `MODEL` (Task 1)
- Produces:
  ```ts
  type GradeOutcome =
    | { status: 'ok'; attemptNo: number; feedback: GradeResult }
    | { status: 'no_such_day' }
    | { status: 'empty_answers' }
    | { status: 'attempt_cap' }
    | { status: 'cap_exceeded' }

  function gradeAnswers(
    deps: { db: Db; clock: Clock; llm: LlmClient },
    subject: Subject, dayNo: number, answers: Record<string, string>,
  ): Promise<GradeOutcome>
  ```

`lib/study/content.ts` 와 같은 모양이다. **순서가 곧 방어선이다:**

```
Day 확인 → 빈 답안 거르기 → 채점 슬롯 예약(DB CHECK) → 예산 예약 → LLM 호출
```

**채점 슬롯을 예산보다 먼저 잡는다.** 더 좁은 제약이 먼저 걸러야
쓸데없이 예산을 건드리지 않는다. 반대로 예산에서 막히면 잡아둔 슬롯을
되돌린다 — 호출도 못 했는데 재시도 기회를 소모하면 안 된다.

**빈 답안을 거른다.** 전부 공백인 제출로 LLM 을 부르는 것은 순수한 낭비다.
이건 화면의 `disabled` 에 의존하지 않는다 — curl 로도 막혀야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/integration/grade.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { FakeLlmClient, FailingLlmClient } from '../../lib/llm/fake'
import { gradeAnswers } from '../../lib/study/grade'
import { reserve } from '../../lib/budget/reserve'
import { dailyCallCap } from '../../lib/budget/caps'
import { attempts, budgetCounters, studyDays, usageLedger } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let llm: FakeLlmClient

const GRADE_PAYLOAD = {
  per_question: [1, 2, 3].map((i) => ({
    id: `q${i}`, score: 67,
    correct_points: ['맞은 것'], missed_points: ['놓친 것'], misconceptions: [],
    feedback_ko: '왕복 횟수를 짚지 않았다. 그게 있어야 근거가 선다.',
  })),
  overall: { score: 67, goal_reached: false, verdict: 'revise' },
  summary_seed: ['항목 1', '항목 2', '항목 3'],
}

const CONTENT = {
  passage: { title: '제목', body_md: '본문', key_terms: [] },
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`, type: 'concept', prompt: `문제 ${i}`,
    expected_points: [`포인트 ${i}`], hint: `힌트 ${i}`,
  })),
}

const ANSWERS = { q1: '답 하나', q2: '답 둘', q3: '답 셋' }

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')
  llm = new FakeLlmClient(GRADE_PAYLOAD)
  vi.stubEnv('APP_ENV', 'local') // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const deps = () => ({ db, clock, llm })

async function seedDay() {
  const [row] = await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01', content: CONTENT,
  }).returning()
  return row
}

describe('채점', () => {
  it('첫 채점은 attempt_no 1 이다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') throw new Error('ok 여야 한다')
    expect(out.attemptNo).toBe(1)
    expect(out.feedback.overall.score).toBe(67)
    expect(llm.calls).toBe(1)
  })

  it('답안과 피드백을 attempts 에 남긴다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    const [row] = await db.select().from(attempts)
    expect(row.answers).toEqual(ANSWERS)
    expect(row.feedback).not.toBeNull()
  })

  it('두 번째 채점은 attempt_no 2 다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status === 'ok' && out.attemptNo).toBe(2)
  })

  it('★ 세 번째는 attempt_cap 이고 LLM 을 부르지 않는다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    const before = llm.calls
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status).toBe('attempt_cap')
    expect(llm.calls).toBe(before) // 늘지 않았다
    expect(await db.select().from(attempts)).toHaveLength(2)
  })

  it('Day 가 없으면 no_such_day 이고 LLM 을 부르지 않는다', async () => {
    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status).toBe('no_such_day')
    expect(llm.calls).toBe(0)
  })

  it('★ 전부 빈 답안은 LLM 을 부르지 않는다 — 순수한 낭비다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, { q1: '  ', q2: '', q3: '\n' })
    expect(out.status).toBe('empty_answers')
    expect(llm.calls).toBe(0)
    expect(await db.select().from(attempts)).toHaveLength(0) // 슬롯도 안 쓴다
  })

  it('하나라도 답이 있으면 채점한다', async () => {
    await seedDay()
    const out = await gradeAnswers(deps(), 'cs', 1, { q1: '답', q2: '', q3: '' })
    expect(out.status).toBe('ok')
  })

  it('★ 예산 캡에 걸리면 채점 슬롯을 되돌린다', async () => {
    await seedDay()
    for (let i = 0; i < dailyCallCap(); i++) await reserve(db, clock)

    const out = await gradeAnswers(deps(), 'cs', 1, ANSWERS)
    expect(out.status).toBe('cap_exceeded')
    expect(llm.calls).toBe(0)
    // 호출도 못 했는데 재시도 기회를 잃으면 안 된다
    expect(await db.select().from(attempts)).toHaveLength(0)
  })

  it('★ LLM 이 실패하면 슬롯과 예산을 모두 되돌린다', async () => {
    await seedDay()
    await expect(
      gradeAnswers({ db, clock, llm: new FailingLlmClient() }, 'cs', 1, ANSWERS),
    ).rejects.toThrow()

    expect(await db.select().from(attempts)).toHaveLength(0)
    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(0)
  })

  it('LLM 이 실패하면 원장에 실패로 남긴다', async () => {
    await seedDay()
    await expect(
      gradeAnswers({ db, clock, llm: new FailingLlmClient() }, 'cs', 1, ANSWERS),
    ).rejects.toThrow()

    const [row] = await db.select().from(usageLedger)
    expect(row.route).toBe('grade')
    expect(row.ok).toBe(false)
  })

  it('★ 스키마에 안 맞는 채점 결과는 저장하지 않는다', async () => {
    await seedDay()
    const bad = new FakeLlmClient({ ...GRADE_PAYLOAD, summary_seed: [] })

    await expect(gradeAnswers({ db, clock, llm: bad }, 'cs', 1, ANSWERS)).rejects.toThrow()
    expect(await db.select().from(attempts)).toHaveLength(0)
  })

  it('성공하면 예산을 1 소모하고 원장에 남긴다', async () => {
    await seedDay()
    await gradeAnswers(deps(), 'cs', 1, ANSWERS)

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(1)

    const [row] = await db.select().from(usageLedger)
    expect(row.route).toBe('grade')
    expect(row.ok).toBe(true)
  })

  it('★ 채점 호출의 temperature 는 0 이다 — 같은 답에 같은 점수', async () => {
    await seedDay()
    let seen = -1
    const spy: typeof llm = {
      calls: 0,
      async generate(req: { temperature: number }) {
        seen = req.temperature
        return { data: GRADE_PAYLOAD, promptTokens: 10, completionTokens: 10, costMicros: 1 }
      },
    } as never

    await gradeAnswers({ db, clock, llm: spy }, 'cs', 1, ANSWERS)
    expect(seen).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/integration/grade.test.ts`
Expected: FAIL — `lib/study/grade` 없음

- [ ] **Step 3: 구현한다**

`lib/study/grade.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm'
import { attempts, studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import { getDay, type Subject } from '../curriculum/load'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import { GRADE_JSON_SCHEMA, GradeSchema, type GradeResult } from '../llm/schemas'
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

function pgCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code
}

/**
 * 채점 슬롯을 잡는다. 번호는 DB 가 정한다.
 *
 * attempts 의 CHECK(attempt_no BETWEEN 1 AND 2)가 3번째 INSERT 를 거부한다 —
 * 상한을 애플리케이션 조건문이 아니라 제약이 강제한다.
 *
 * 동시에 두 요청이 같은 번호를 계산하면 UNIQUE 가 하나를 튕긴다.
 * 그때는 한 번 더 시도한다 (그 사이 MAX 가 올라갔으므로 다음 번호를 잡는다).
 */
async function reserveAttempt(
  db: Db, studyDayId: number, answers: Record<string, string>,
): Promise<number | null> {
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    try {
      // drizzle 의 쿼리 빌더를 쓴다. db.execute 의 반환 모양은 드라이버마다
      // 다르지만(neon-http 는 { rows }, PGlite 는 배열) 이 경로는 어디서나
      // 타입이 붙은 배열을 준다.
      const [row] = await db.insert(attempts).values({
        studyDayId,
        // 번호를 서브쿼리로 계산해 한 문장 안에서 끝낸다. 읽고-계산하고-쓰기로
        // 나누면 그 사이에 다른 요청이 같은 번호를 가져갈 수 있다.
        attemptNo: sql`(SELECT COALESCE(MAX(attempt_no), 0) + 1
                          FROM attempts WHERE study_day_id = ${studyDayId})`,
        answers,
      }).returning({ attemptNo: attempts.attemptNo })
      return row.attemptNo
    } catch (e) {
      if (pgCode(e) === CHECK_VIOLATION) return null   // 상한 도달
      if (pgCode(e) === UNIQUE_VIOLATION) continue     // 경쟁 — 다시
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

  const questions = (day.content as { questions: Parameters<typeof gradeUserMessage>[1] }).questions

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
      throw new Error(`채점 결과가 스키마와 다릅니다: ${parsed.error.issues[0]?.message}`)
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/integration/grade.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: ★ 제약을 역검증한다**

`attempts` 의 CHECK 가 실제로 일하는지 확인한다.

**★ `lib/db/schema.ts` 를 고쳐도 소용없다.** PGlite 하네스는 스키마 파일이
아니라 `drizzle/0000_*.sql` 마이그레이션을 실행한다 (`tests/helpers/testDb.ts`).
제약을 무력화할 곳은 마이그레이션이다:

```bash
MIG=$(ls drizzle/0000_*.sql)
cp "$MIG" /tmp/mig.bak
# CONSTRAINT "attempt_cap" CHECK (...) 를 CHECK (true) 로 바꾼다
```

Run: `npx vitest run tests/integration/grade.test.ts`
Expected: **「세 번째는 attempt_cap」테스트만 FAIL**

확인했으면 주석을 되돌리고 다시 통과시킨다. 이 절차를 건너뛰지 않는다 —
1주차의 예산 카운터에서도 이 역검증이 진짜 레이스를 잡아냈다.

- [ ] **Step 6: 커밋**

```bash
git add lib/study/grade.ts tests/integration/grade.test.ts
git commit -m "feat: 채점 오케스트레이션

content.ts 와 같은 모양이다. 순서가 곧 방어선이다 —
Day 확인 → 빈 답안 거르기 → 채점 슬롯 → 예산 → LLM.

채점 슬롯을 예산보다 먼저 잡는다. 더 좁은 제약이 먼저 걸러야 쓸데없이
예산을 건드리지 않는다. 반대로 예산에서 막히면 잡아둔 슬롯을 되돌린다 —
호출도 못 했는데 재시도 기회를 잃으면 안 된다.

슬롯 번호는 DB 가 정한다. attempts 의 CHECK 가 3번째 INSERT 를 거부하고,
동시 요청이 같은 번호를 계산하면 UNIQUE 가 하나를 튕긴다. 그때는 한 번
더 시도한다. 상한을 애플리케이션 조건문이 아니라 제약이 강제한다.

전부 공백인 제출을 거른다. 화면의 disabled 에 의존하지 않는다 —
curl 로도 막혀야 한다.

temperature 0 을 테스트로 박았다. 같은 답안에 같은 점수가 나와야
채점을 신뢰할 수 있다."
```

---

## Task 9: 채점 라우트와 결과 화면

**Files:**
- Create: `app/api/study/[subject]/grade/route.ts`
- Create: `components/GradeResult.tsx`
- Create: `lib/study/complete.ts`
- Create: `app/api/study/[subject]/complete/route.ts`
- Modify: `app/study/[subject]/page.tsx` (Task 7 의 자리표시자를 교체)
- Test: `tests/study/complete.test.ts`

**Interfaces:**
- Consumes: `gradeAnswers` (Task 8), `withSession` (`lib/session/guard`)
- Produces:
  - `POST /api/study/[subject]/grade` → 200 `{ attemptNo, feedback }` / 4xx `{ error }`
  - `POST /api/study/[subject]/complete` → 204
  - `completeDay(db, subject, dayNo, gradingDisputed: boolean)`

디자인은 캔버스의 **4번 아트보드**다.

**「이 채점이 틀렸다」는 LLM 을 부르지 않는다** (스펙 §5.8). 플래그만 남기고
Day 를 `completed` 로 넘긴다. 수학에서 모델이 루브릭을 틀리게 만들었을 때
사용자가 갇히지 않게 하는 탈출구이고, 비용은 0원이다.

- [ ] **Step 1: 채점 라우트를 만든다**

`app/api/study/[subject]/grade/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { OpenAiLlmClient } from '@/lib/llm/client'
import { gradeAnswers, type GradeOutcome } from '@/lib/study/grade'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

const llm = new OpenAiLlmClient()

const STATUS_CODE: Record<Exclude<GradeOutcome['status'], 'ok'>, number> = {
  no_such_day: 404,
  empty_answers: 400,
  attempt_cap: 429,
  cap_exceeded: 429,
}

export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as
    { dayNo?: unknown; answers?: unknown } | null

  const dayNo = Number(body?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  const raw = body?.answers
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_ANSWERS' }, { status: 400 })
  }
  // 값은 문자열만 통과시킨다. 객체가 섞이면 프롬프트에 [object Object] 가 들어간다.
  const answers = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string') as Array<[string, string]>,
  )

  const outcome = await gradeAnswers({ db, clock: systemClock, llm }, subject as Subject, dayNo, answers)

  if (outcome.status === 'ok') {
    return NextResponse.json({ attemptNo: outcome.attemptNo, feedback: outcome.feedback })
  }
  return NextResponse.json(
    { error: outcome.status.toUpperCase() },
    { status: STATUS_CODE[outcome.status] },
  )
})
```

- [ ] **Step 2: Day 완료 처리의 테스트를 쓴다**

`tests/study/complete.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { completeDay } from '../../lib/study/complete'
import { studyDays } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')
  await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01', content: {},
  })
})
afterEach(async () => { await close() })

const day = async () => (await db.select().from(studyDays)
  .where(eq(studyDays.subject, 'cs')))[0]

describe('completeDay', () => {
  it('status 를 completed 로 바꾸고 완료 시각을 남긴다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const d = await day()
    expect(d.status).toBe('completed')
    expect(d.completedAt).not.toBeNull()
  })

  it('★ 채점 이의 제기를 기록한다 — LLM 을 다시 부르지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, true)
    const d = await day()
    expect(d.status).toBe('completed')
    expect((d.content as { grading_disputed?: boolean }).grading_disputed).toBe(true)
  })

  it('이의 제기가 아니면 플래그를 남기지 않는다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const d = await day()
    expect((d.content as { grading_disputed?: boolean }).grading_disputed).toBeUndefined()
  })

  it('두 번 불러도 결과가 같다 — 새로고침으로 두 번 눌릴 수 있다', async () => {
    await completeDay(db, clock, 'cs', 1, false)
    const first = (await day()).completedAt
    clock.advance(60_000)
    await completeDay(db, clock, 'cs', 1, false)
    // 처음 완료한 시각을 덮어쓰지 않는다
    expect((await day()).completedAt).toEqual(first)
  })

  it('없는 Day 는 조용히 넘어간다', async () => {
    await expect(completeDay(db, clock, 'cs', 99, false)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/study/complete.test.ts`
Expected: FAIL — `lib/study/complete` 없음

- [ ] **Step 4: 완료 처리를 구현한다**

`lib/study/complete.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import type { Subject } from '../curriculum/load'

/**
 * Day 를 마친다.
 *
 * `gradingDisputed` 는 「이 채점이 틀렸다」다 (스펙 §5.8). LLM 을 다시
 * 부르지 않고 플래그만 남긴다 — 모델이 루브릭을 틀리게 만들었을 때
 * 사용자가 그 Day 에 갇히지 않게 하는 탈출구이고 비용은 0원이다.
 * 나중에 이 기록을 보고 커리큘럼을 고친다.
 *
 * completedAt 이 이미 있으면 덮어쓰지 않는다 — 새로고침으로 두 번
 * 눌릴 수 있고, 그때 완료 시각이 밀리면 기록이 거짓말이 된다.
 */
export async function completeDay(
  db: Db, clock: Clock, subject: Subject, dayNo: number, gradingDisputed: boolean,
): Promise<void> {
  await db.update(studyDays)
    .set({
      status: 'completed',
      completedAt: clock.now(),
      ...(gradingDisputed
        ? { content: sql`${studyDays.content} || '{"grading_disputed":true}'::jsonb` }
        : {}),
    })
    .where(and(
      eq(studyDays.subject, subject),
      eq(studyDays.dayNo, dayNo),
      isNull(studyDays.completedAt), // 이미 마쳤으면 건드리지 않는다
    ))
}
```

`app/api/study/[subject]/complete/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { completeDay } from '@/lib/study/complete'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

/** LLM 을 부르지 않는다. 예산도 쓰지 않는다. */
export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as
    { dayNo?: unknown; disputed?: unknown } | null

  const dayNo = Number(body?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  await completeDay(db, systemClock, subject as Subject, dayNo, body?.disputed === true)
  return new NextResponse(null, { status: 204 })
})
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/study/complete.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: 채점 결과 화면을 만든다**

`components/GradeResult.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface QuestionFeedback {
  id: string
  score: number
  correct_points: string[]
  missed_points: string[]
  misconceptions: string[]
  feedback_ko: string
}

export interface Feedback {
  per_question: QuestionFeedback[]
  overall: { score: number; goal_reached: boolean; verdict: 'pass' | 'revise' }
  summary_seed: string[]
}

export interface GradeResultProps {
  subject: string
  dayNo: number
  attemptNo: number
  attemptsLeft: number
  questions: Array<{ id: string; prompt: string }>
  answers: Record<string, string>
  feedback: Feedback
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-[5px] shrink-0">
    <path d="M2.5 7.4L5.5 10.4L11.5 3.6" stroke="var(--color-ok)" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Dash = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-[5px] shrink-0">
    <path d="M3 7H11" stroke="var(--color-warn)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

export function GradeResult(props: GradeResultProps) {
  const { subject, dayNo, attemptNo, attemptsLeft, questions, answers, feedback } = props
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function finish(disputed: boolean) {
    setBusy(true)
    await fetch(`/api/study/${subject}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayNo, disputed }),
    })
    router.push('/')
    router.refresh()
  }

  const total = feedback.per_question.reduce(
    (n, q) => n + q.correct_points.length + q.missed_points.length, 0)
  const got = feedback.per_question.reduce((n, q) => n + q.correct_points.length, 0)

  return (
    <div className="mt-14 flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-3.5">
          <div className="font-mono text-xs tracking-[0.14em] text-faint">
            {attemptNo}회차 채점
          </div>
          <h2 className="font-serif text-4xl leading-snug text-ink">채점 결과</h2>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-[44px] leading-none text-ink">{got}</span>
          <span className="font-mono text-sm text-faint">/ {total}</span>
        </div>
      </div>

      <div className="mt-11 flex flex-col gap-7">
        {feedback.per_question.map((q) => {
          const question = questions.find((x) => x.id === q.id)
          const points = q.correct_points.length + q.missed_points.length
          return (
            <div key={q.id} className="flex flex-col rounded-card border border-rule bg-surface px-[26px] pt-[26px] pb-6">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-xs text-faint">{q.id.toUpperCase()}</span>
                <span className={`font-mono text-xs ${q.missed_points.length === 0 ? 'text-ok' : 'text-warn'}`}>
                  {q.correct_points.length} / {points}
                </span>
              </div>

              <p className="mt-2.5 font-serif text-lg leading-relaxed text-ink">
                {question?.prompt}
              </p>

              <p className="mt-[18px] border-l-2 border-rule-soft pl-3.5 text-sm leading-[1.8] text-muted">
                {answers[q.id]?.trim() || '(답을 쓰지 않음)'}
              </p>

              <div className="mt-5 flex flex-col gap-2.5">
                {q.correct_points.map((p) => (
                  <div key={p} className="flex gap-2.5">
                    <Check />
                    <span className="text-[14.5px] leading-[1.7] text-body">{p}</span>
                  </div>
                ))}
                {q.missed_points.map((p) => (
                  <div key={p} className="flex gap-2.5">
                    <Dash />
                    <span className="text-[14.5px] leading-[1.7] text-body">
                      <span className="text-warn">놓침 — </span>{p}
                    </span>
                  </div>
                ))}
              </div>

              {q.misconceptions.length > 0 && (
                <div className="mt-5 flex flex-col gap-1.5 rounded-control bg-stop-tint px-4 py-3.5">
                  <span className="font-mono text-[11px] tracking-[0.1em] text-stop">바로잡을 것</span>
                  {q.misconceptions.map((m) => (
                    <span key={m} className="text-[14.5px] leading-[1.7] text-body">{m}</span>
                  ))}
                </div>
              )}

              <p className="mt-5 text-[14.5px] leading-[1.75] text-muted">{q.feedback_ko}</p>
            </div>
          )
        })}
      </div>

      <div className="mt-11 h-px bg-rule" />

      <div className="mt-5 flex items-center justify-between gap-6">
        <button
          onClick={() => finish(true)}
          disabled={busy}
          className="h-11 cursor-pointer rounded-control border border-rule-strong px-[18px] text-sm text-body hover:bg-paper disabled:opacity-40"
        >
          이 채점이 틀렸다
        </button>
        <div className="flex items-center gap-[18px]">
          <span className="text-[13px] text-faint">
            재채점 남은 횟수 <span className="font-mono text-body">{attemptsLeft}</span>
          </span>
          <button
            onClick={() => finish(false)}
            disabled={busy}
            className="h-12 cursor-pointer rounded-control bg-ink px-7 text-[15px] font-medium text-paper disabled:opacity-40"
          >
            오늘 마치기
          </button>
        </div>
      </div>

      <p className="mt-4 text-[12.5px] leading-[1.7] text-faint">
        「이 채점이 틀렸다」는 AI 를 다시 부르지 않는다. 기록만 남기고 오늘을 마친다.
      </p>
    </div>
  )
}
```

- [ ] **Step 7: 학습 페이지의 자리표시자를 교체한다**

`app/study/[subject]/page.tsx` 에서 Task 7 의 안내 문단을 지우고:

```tsx
import { GradeResult } from '@/components/GradeResult'
```

```tsx
        {graded ? (
          <GradeResult
            subject={subject}
            dayNo={progress.dayNo}
            attemptNo={graded.attemptNo}
            attemptsLeft={ATTEMPT_CAP - tries.length}
            questions={content.questions}
            answers={graded.answers as Record<string, string>}
            feedback={graded.feedback as never}
          />
        ) : (
```

- [ ] **Step 8: 검증하고 커밋한다**

```bash
npm test && npx tsc --noEmit && npm run check:secrets && npm run build
```

```bash
git add -A
git commit -m "feat: 채점 라우트와 결과 화면

디자인 캔버스 4번 아트보드를 구현했다.

「이 채점이 틀렸다」는 LLM 을 부르지 않는다 (스펙 §5.8). 플래그만
남기고 Day 를 completed 로 넘긴다. 모델이 루브릭을 틀리게 만들었을 때
사용자가 그 Day 에 갇히지 않게 하는 탈출구이고 비용은 0원이다.

completeDay 는 completedAt 이 이미 있으면 건드리지 않는다.
새로고침으로 두 번 눌릴 수 있고 그때 완료 시각이 밀리면 기록이
거짓말이 된다.

라우트가 answers 의 값에서 문자열만 통과시킨다. 객체가 섞이면
프롬프트에 [object Object] 가 들어간다."
```

---

## Task 10: 힌트 — LLM 호출 0회

**Files:**
- Create: `app/api/study/[subject]/hint/route.ts`
- Modify: `components/AnswerForm.tsx` (문제마다 「힌트 보기」)
- Test: `tests/integration/hint-route.test.ts`

**Interfaces:**
- Produces: `GET /api/study/[subject]/hint?dayNo=1&questionId=q2` → `{ hint: string }`

힌트는 콘텐츠 생성 때 이미 만들어져 DB 에 있다 (스펙 §5.4).
**꺼내 주기만 한다 — 비용이 0원이다.** LLM 을 부르는 순간 이 라우트의 존재 이유가 사라진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/integration/hint-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { readHint } from '../../lib/study/hint'
import { studyDays } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  await db.insert(studyDays).values({
    subject: 'cs', dayNo: 1, studyDate: '2026-09-01',
    content: {
      passage: { title: 't', body_md: 'b', key_terms: [] },
      questions: [
        { id: 'q1', type: 'recall', prompt: 'p', expected_points: ['비밀 루브릭'], hint: '첫 힌트' },
        { id: 'q2', type: 'concept', prompt: 'p', expected_points: ['비밀'], hint: '둘째 힌트' },
      ],
    },
  })
})
afterEach(async () => { await close() })

describe('힌트', () => {
  it('DB 에 저장된 힌트를 준다', async () => {
    expect(await readHint(db, 'cs', 1, 'q2')).toBe('둘째 힌트')
  })

  it('★ 루브릭을 함께 흘리지 않는다', async () => {
    const hint = await readHint(db, 'cs', 1, 'q1')
    expect(hint).toBe('첫 힌트')
    expect(hint).not.toContain('비밀')
  })

  it('없는 문제는 null 이다', async () => {
    expect(await readHint(db, 'cs', 1, 'q9')).toBeNull()
  })

  it('없는 Day 는 null 이다', async () => {
    expect(await readHint(db, 'cs', 99, 'q1')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/integration/hint-route.test.ts`
Expected: FAIL — `lib/study/hint` 없음

- [ ] **Step 3: 구현한다**

`lib/study/hint.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Subject } from '../curriculum/load'

/**
 * 힌트를 DB 에서 꺼낸다. **LLM 을 부르지 않는다.**
 *
 * 힌트는 콘텐츠 생성 때 이미 만들어져 저장돼 있다 (스펙 §5.4).
 * 여기서 모델을 부르는 순간 이 라우트의 존재 이유가 사라진다.
 *
 * 문제 하나의 hint 만 돌려준다. content 를 통째로 주면 expected_points 가 따라 나간다.
 */
export async function readHint(
  db: Db, subject: Subject, dayNo: number, questionId: string,
): Promise<string | null> {
  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, dayNo)))
  if (!day) return null

  const questions = (day.content as { questions?: Array<{ id: string; hint?: string }> }).questions
  return questions?.find((q) => q.id === questionId)?.hint ?? null
}
```

`app/api/study/[subject]/hint/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { withSession } from '@/lib/session/guard'
import { readHint } from '@/lib/study/hint'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

/** LLM 을 부르지 않고 예산도 쓰지 않는다. 비용 0원이다. */
export const GET = withSession<{ subject: string }>(async (req, _session, ctx) => {
  const { subject } = await ctx.params
  if (!(SUBJECTS as readonly string[]).includes(subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const url = new URL(req.url)
  const dayNo = Number(url.searchParams.get('dayNo'))
  const questionId = url.searchParams.get('questionId') ?? ''
  if (!Number.isInteger(dayNo) || dayNo < 1 || !questionId) {
    return NextResponse.json({ error: 'INVALID_QUERY' }, { status: 400 })
  }

  const hint = await readHint(db, subject as Subject, dayNo, questionId)
  if (hint === null) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ hint })
})
```

- [ ] **Step 4: 답안 폼에 힌트 버튼을 붙인다**

`components/AnswerForm.tsx` 안에 문제별 힌트 상태를 둔다:

```tsx
  const [hints, setHints] = useState<Record<string, string>>({})

  async function showHint(id: string) {
    if (hints[id]) return
    const res = await fetch(`/api/study/${subject}/hint?dayNo=${dayNo}&questionId=${id}`)
    if (!res.ok) return
    const body = await res.json()
    setHints((h) => ({ ...h, [id]: body.hint }))
  }
```

각 문제의 textarea 아래 글자 수 옆에 넣는다:

```tsx
            <div className="flex items-center justify-between">
              {hints[q.id] ? (
                <span className="text-[13px] leading-[1.7] text-muted">힌트 — {hints[q.id]}</span>
              ) : (
                <button
                  onClick={() => showHint(q.id)}
                  className="cursor-pointer text-[13px] text-muted underline underline-offset-2 hover:text-body"
                >
                  힌트 보기
                </button>
              )}
              <span className="font-mono text-[11px] text-ghost">
                {(answers[q.id] ?? '').length}자
              </span>
            </div>
```

- [ ] **Step 5: 검증하고 커밋한다**

```bash
npm test && npx tsc --noEmit && npm run build
```

```bash
git add -A
git commit -m "feat: 힌트 라우트 — LLM 호출 0회

힌트는 콘텐츠 생성 때 이미 만들어져 DB 에 저장돼 있다 (스펙 §5.4).
꺼내 주기만 한다. 여기서 모델을 부르는 순간 이 라우트의 존재 이유가
사라진다.

문제 하나의 hint 만 돌려준다. content 를 통째로 주면 expected_points 가
따라 나간다 — 루브릭 유출 방지를 테스트로 박았다."
```

---

## Task 11: Day 시작 — 대시보드에서 콘텐츠를 만든다

**Files:**
- Create: `components/StartDay.tsx`
- Modify: `app/study/[subject]/page.tsx` (콘텐츠가 없을 때 대시보드로 보내지 않는다)

**Interfaces:**
- Consumes: `POST /api/study/[subject]/content` (Task 5)

Task 7 까지는 콘텐츠를 curl 로만 만들 수 있었다. 여기서 화면에 붙인다.

**「오늘 시작하기」가 곧 돈을 쓰는 버튼이다.** 그 사실을 숨기지 않는다 —
버튼 옆에 오늘 남은 호출 수를 적는다.

- [ ] **Step 1: 시작 컴포넌트를 만든다**

`components/StartDay.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface StartDayProps {
  subject: string
  dayNo: number
  topic: string
  goal: string
  callsLeft: number
}

export function StartDay({ subject, dayNo, topic, goal, callsLeft }: StartDayProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/study/${subject}/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayNo }),
    })

    if (res.ok) { router.refresh(); return }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'CAP_EXCEEDED' ? '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.'
      : body.error === 'ALREADY_STUDIED_TODAY' ? '이 과목은 오늘 이미 했다. 내일 이어서 한다.'
      : '지문을 만들지 못했다. 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-11 flex flex-col rounded-card border border-rule bg-surface px-[34px] py-9">
      <h2 className="font-serif text-[26px] leading-snug text-ink">{topic}</h2>
      <p className="mt-3 text-[14.5px] leading-[1.7] text-muted">{goal}</p>

      <p className="mt-6 text-[14.5px] leading-[1.75] text-body">
        시작하면 오늘치 지문과 문제 3개가 만들어진다. 한 번 만들면 오늘은 다시
        만들 수 없고, 이 Day 의 내용은 앞으로도 이것 하나다.
      </p>

      {error && <p className="mt-4 text-[13px] leading-relaxed text-stop">{error}</p>}

      <div className="mt-7 flex items-center justify-between gap-6">
        <span className="font-mono text-[11.5px] tracking-[0.1em] text-faint">
          오늘 남은 AI 호출 {callsLeft}
        </span>
        <button
          onClick={start}
          disabled={busy || callsLeft <= 0}
          className="h-12 cursor-pointer rounded-control bg-ink px-7 text-[15px] font-medium text-paper disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? '만드는 중…' : '오늘 시작하기'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 학습 페이지가 이걸 쓰게 한다**

`app/study/[subject]/page.tsx` 에서 `if (!day) redirect('/')` 를 지우고,
`loadUsage` 를 함께 읽어 남은 호출 수를 넘긴다.

```tsx
import { loadProgress, loadUsage } from '@/lib/study/progress'
import { StartDay } from '@/components/StartDay'
```

```tsx
  const usage = await loadUsage(db, systemClock)
```

`day` 가 없을 때 지문 대신 `StartDay` 를 그린다:

```tsx
        {!day ? (
          <StartDay
            subject={subject}
            dayNo={progress.dayNo}
            topic={entry.topic}
            goal={entry.goal}
            callsLeft={Math.max(0, usage.dailyCap - usage.dailyCalls)}
          />
        ) : (
          <>
            <Passage … />
            {graded ? <GradeResult … /> : <AnswerForm … />}
          </>
        )}
```

`day` 가 없으면 `content` / `tries` / `graded` 를 읽지 않아야 한다.
페이지의 본문 계산과 렌더를 아래로 통째로 바꾼다:

```tsx
  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, progress.dayNo)))

  // day 가 없으면 아직 시작 전이다. attempts 도 content 도 읽을 게 없다.
  const tries = day
    ? await db.select().from(attempts).where(eq(attempts.studyDayId, day.id))
    : []
  const graded = tries
    .filter((t) => t.feedback !== null)
    .sort((a, b) => b.attemptNo - a.attemptNo)[0]

  const content = day
    ? (day.content as {
        passage: { title: string; body_md: string; key_terms: Array<{ term: string; definition: string }> }
        questions: Array<{ id: string; type: string; prompt: string }>
      })
    : null

  const usage = await loadUsage(db, systemClock)
  const label = loadCurriculum(subject as Subject).label
```

```tsx
        {content === null ? (
          <StartDay
            subject={subject}
            dayNo={progress.dayNo}
            topic={entry.topic}
            goal={entry.goal}
            callsLeft={Math.max(0, usage.dailyCap - usage.dailyCalls)}
          />
        ) : (
          <>
            <Passage
              title={content.passage.title}
              bodyMd={content.passage.body_md}
              keyTerms={content.passage.key_terms}
            />

            {graded ? (
              <GradeResult
                subject={subject}
                dayNo={progress.dayNo}
                attemptNo={graded.attemptNo}
                attemptsLeft={ATTEMPT_CAP - tries.length}
                questions={content.questions}
                answers={graded.answers as Record<string, string>}
                feedback={graded.feedback as never}
              />
            ) : (
              <AnswerForm
                subject={subject}
                dayNo={progress.dayNo}
                questions={content.questions}
                attemptsLeft={ATTEMPT_CAP - tries.length}
              />
            )}
          </>
        )}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm test && npx tsc --noEmit && npm run build
```

`npm run dev` 로 띄우고 **수학** 과목을 연다 (CS 는 Task 5 에서 이미 만들었다).
「오늘 시작하기」를 누르면 지문이 생기고, 새로고침해도 다시 만들어지지 않는다.

```bash
git add -A
git commit -m "feat: 화면에서 Day 를 시작한다

Task 7 까지는 콘텐츠를 curl 로만 만들 수 있었다. 화면에 붙였다.

「오늘 시작하기」가 곧 돈을 쓰는 버튼이다. 그 사실을 숨기지 않고
버튼 옆에 오늘 남은 호출 수를 적었다. 0 이면 눌리지 않는다 —
화면이 막는 게 아니라 서버가 막지만, 누르고 나서 알 이유가 없다."
```

---

## Task 12: CS Day 1 완주와 실측

**Files:**
- Create: `scripts/peek.mjs`
- Modify: `docs/HANDOFF.md`, `docs/DECISIONS.md`

2주차의 완료 기준은 **"CS Day 1 을 실제로 완주"** 다. 코드가 아니라 사용이다.

- [ ] **Step 1: 원장을 보는 스크립트를 만든다**

`scripts/peek.mjs`:

```js
/**
 * 실측을 본다. 읽기만 한다.
 *   node scripts/peek.mjs
 */
process.loadEnvFile('.env.local')
const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

console.log('\n─ usage_ledger ─')
console.table(await sql`
  SELECT route, model, prompt_tokens, completion_tokens, cost_micros, ok
    FROM usage_ledger ORDER BY id`)

console.log('\n─ budget_counters ─')
console.table(await sql`SELECT period_key, calls, cost_micros, cap_calls, cap_micros
                          FROM budget_counters ORDER BY period_key`)

console.log('\n─ study_days ─')
console.table(await sql`SELECT subject, day_no, study_date, status FROM study_days
                          ORDER BY subject, day_no`)

console.log('\n─ attempts ─')
console.table(await sql`SELECT study_day_id, attempt_no, (feedback IS NOT NULL) AS graded
                          FROM attempts ORDER BY study_day_id, attempt_no`)

const [sum] = await sql`SELECT COALESCE(SUM(cost_micros), 0)::int AS total FROM usage_ledger`
console.log(`\n총 사용액: $${(sum.total / 1_000_000).toFixed(4)}\n`)
```

- [ ] **Step 2: 손으로 완주한다**

```bash
npm run dev
```

1. 로그인 → 대시보드 → **CS** 「이어서 하기」
2. 지문을 읽는다. **700~1000자인가? 예시가 있는가? goal 과 상관없는 곁가지가 없는가?**
3. 문제 하나에서 「힌트 보기」를 누른다 → 힌트가 뜬다.
   `node scripts/peek.mjs` 로 **`usage_ledger` 행이 늘지 않았는지** 확인한다 (비용 0원)
4. 세 문제에 답을 쓴다. **중간에 새로고침한다** → 답이 남아 있어야 한다
5. 「제출하고 채점받기」
6. 채점 결과를 본다. **맞은 포인트 / 놓친 포인트가 내 답과 맞는가?**
   **표현이 달라도 맞다고 봐주는가?**
7. 「오늘 마치기」 → 대시보드로. CS 카드가 「오늘 마쳤다」

- [ ] **Step 3: 이상한 것을 기록한다**

아래를 `docs/DECISIONS.md` 에 남긴다. **좋았던 것보다 이상했던 것이 중요하다.**

- 지문 품질: 길이, 예시 유무, goal 과의 관련성
- 채점 품질: 루브릭 대조가 맞았는가, 억울한 오답 처리가 있었는가
- `summary_seed` 가 3주차 정리본 화면에 쓸 만한가
- 실제 토큰 수와 비용 (`scripts/peek.mjs`)

- [ ] **Step 4: 캡을 실측으로 다시 잡는다**

`node scripts/peek.mjs` 의 `cost_micros` 를 본다.

Day 하나 완주 = content 1 + grade 1~2 회. 그 값에 3과목 × 30일을 곱한 것이
월 예상치다. 계획 단계의 추정은 **월 $0.35** 였다.

- 실측이 추정의 **2배 이내**면 `monthlyCostCapMicros()` 의 $3 을 유지한다
- **2배를 넘으면** 프롬프트가 예상보다 길다는 뜻이다. 캡을 올리지 말고
  **`max_tokens` 와 프롬프트를 줄인다.** 캡을 올리는 것은 마지막 수단이다

- [ ] **Step 5: 핸드오프를 갱신하고 커밋한다**

`docs/HANDOFF.md` 를 2주차 종료 상태로 통째로 덮어쓴다. 반드시 담을 것:

- 실측 비용과 그것으로 캡을 어떻게 했는지
- 지문·채점 품질에서 발견한 것
- 3주차가 이어받을 것: `summary_seed` 는 이미 DB 에 있다 (정리본 화면이 이걸 쓴다)

```bash
git add -A
git commit -m "docs: 2주차 종료 — CS Day 1 완주와 실측

완료 기준은 코드가 아니라 사용이었다. 지문을 읽고 문제를 풀고
채점을 받고 Day 를 마쳤다.

scripts/peek.mjs 로 원장을 본다. 실측 비용과 그것으로 캡을 어떻게
했는지, 지문·채점 품질에서 발견한 것을 DECISIONS 에 남겼다."
```

---

## 2주차 완료 기준

아래가 전부 참이어야 2주차가 끝난 것이다.

- [ ] `npm test` 통과 — 채점 상한, 빈 답안 차단, 슬롯 롤백, 스키마 검증이 포함돼 있다
- [ ] `npm run check:secrets` 통과
- [ ] `npx tsc --noEmit` 에러 0개
- [ ] `npm run build` 통과
- [ ] **`OPENAI_API_KEY` 를 읽는 파일이 `lib/llm/client.ts` 하나다** (테스트가 증명)
- [ ] `usage_ledger` 에 `model='gpt-4o-mini'` 인 행이 쌓였고 `cost_micros` 가 0 이 아니다
- [ ] **CS Day 1 을 화면에서 완주했다** — 지문 → 답안 → 채점 → 마치기
- [ ] 같은 Day 를 다시 열어도 `usage_ledger` 행이 늘지 않는다 (멱등성)
- [ ] 세 번째 채점 시도가 429 로 막힌다
- [ ] 힌트를 눌러도 `usage_ledger` 행이 늘지 않는다
- [ ] 실측 비용을 확인하고 캡을 유지하거나 프롬프트를 줄였다
- [ ] `docs/HANDOFF.md` 가 2주차 종료 상태를 반영한다

---

## 자체 점검

**스펙 커버리지** — 스펙 §10 의 2주차 항목 대응:

| 스펙 항목 | 태스크 |
|---|---|
| `lib/llm/client.ts` — Structured Outputs, 타임아웃, 토큰 기록 | 1, 2, 3, 4 |
| `content` 라우트 + 멱등성 + `expected_points` 제거 | 5 (멱등성·제거는 1주차에 완료, 여기서 실호출로 확인) |
| `grade` 라우트 + 2회 상한 | 8, 9 |
| 학습 화면: 지문 → 답안 3개 → 채점 결과 → "채점이 틀렸다" | 6, 7, 9 |
| Day 완료 처리, 진도 계산, 대시보드 3카드 | 9 (완료), 11 (시작) — 진도·대시보드는 1주차에 완료 |
| 실측 비용 확인 후 캡 재조정 | 12 |

**스펙에 있으나 이 계획 밖** (3주차로): 정리본 작성 화면, `polish` 라우트,
`/admin/usage`, 지난 Day 열람, 커리큘럼 Day 8~30 확장, 모바일 레이아웃.

**1주차에서 넘어온 약속:** `SessionBar` 의 `expiringNote` — Task 6·7 에서 지킨다.

**계획을 벗어난 판단 셋:**

1. **`openai` 패키지를 쓰지 않는다.** 의존성 0, `AbortSignal.timeout` 완전 제어,
   버셀 번들이 가볍다. Structured Outputs 는 JSON 바디 하나다.
2. **`tests/no-real-llm.test.ts` 를 지우지 않고 바꾼다.** "LLM 금지"에서
   "API 키의 경계 감시"로. `CLAUDE.md` 의 살아 있는 규칙을 계속 지킨다.
3. **빈 답안 차단을 서버에 둔다.** 화면의 `disabled` 는 편의이고, curl 로도
   막혀야 진짜 방어다.

**아직 안 정한 것:** 채점 품질이 나쁘면 어떻게 할지. 스펙 §5.8 은
「이 채점이 틀렸다」 버튼과 커리큘럼 수정을 말한다. 상위 모델로 올리는
선택지는 열려 있으나 **실측 없이 결정하지 않는다** — Task 12 에서 판단한다.
