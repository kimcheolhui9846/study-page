import { describe, it, expect } from 'vitest'
import {
  CONTENT_JSON_SCHEMA, GRADE_JSON_SCHEMA,
  ContentSchema, GradeSchema,
} from '../../lib/llm/schemas'

/**
 * strict 모드가 요구하는 모양을 재귀로 확인한다.
 *
 * OpenAI 의 strict:true 는 모든 object 에 additionalProperties:false 와
 * 모든 키를 담은 required 를 요구한다. 하나라도 빠지면 API 가 400 을 준다 —
 * 그걸 실호출로 알아내면 그 시도가 곧 비용이다.
 */
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

  it('★ expected_points 가 비면 거른다 — 채점할 근거가 없다', () => {
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

  it('빈 hint 는 통과시킨다 — strict 모드가 선택 필드를 못 만든다', () => {
    const ok = {
      ...validContent,
      questions: validContent.questions.map((q) => ({ ...q, hint: '' })),
    }
    expect(ContentSchema.safeParse(ok).success).toBe(true)
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

  it('★ summary_seed 가 비면 거른다 — 3주차 정리본 화면이 이걸 쓴다', () => {
    expect(GradeSchema.safeParse({ ...validGrade, summary_seed: [] }).success).toBe(false)
  })

  it('놓친 포인트가 없는 만점 답안도 통과시킨다', () => {
    const perfect = {
      ...validGrade,
      per_question: validGrade.per_question.map((q) => ({ ...q, score: 100, missed_points: [] })),
      overall: { score: 100, goal_reached: true, verdict: 'pass' },
    }
    expect(GradeSchema.safeParse(perfect).success).toBe(true)
  })
})
