import { describe, it, expect } from 'vitest'
import {
  CONTENT_JSON_SCHEMA, REVIEW_JSON_SCHEMA, GRADE_JSON_SCHEMA,
  ContentSchema, ReviewSchema, GradeSchema,
  materialOfContent, materialOfReview, publicQuestions, solutionsOf, hintFor,
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

describe('REVIEW_JSON_SCHEMA', () => {
  it('★ strict 모드 요구사항을 만족한다', () => {
    assertStrictShape(REVIEW_JSON_SCHEMA)
  })

  it('복습 문제는 2개다 — 신규보다 짧다', () => {
    const q = REVIEW_JSON_SCHEMA.properties.questions
    expect(q.minItems).toBe(2)
    expect(q.maxItems).toBe(2)
  })

  it('★ 지문을 다시 만들지 않는다 — passage 필드가 없다', () => {
    expect(Object.keys(REVIEW_JSON_SCHEMA.properties)).not.toContain('passage')
  })
})

describe('GRADE_JSON_SCHEMA', () => {
  it('★ strict 모드 요구사항을 만족한다', () => {
    assertStrictShape(GRADE_JSON_SCHEMA)
  })

  it('★ 모델에게 점수를 묻지 않는다 — 숫자는 우리가 만든다', () => {
    expect(JSON.stringify(GRADE_JSON_SCHEMA)).not.toContain('\"score\"')
  })

  it('★ Topic 단위로 응답한다 — 계획 하나를 한 번에 채점하므로', () => {
    expect(Object.keys(GRADE_JSON_SCHEMA.properties)).toEqual(['topics'])
    expect(Object.keys(GRADE_JSON_SCHEMA.properties.topics.items.properties))
      .toContain('topic_id')
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
    solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
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

const validReview = {
  recap_md: '되짚기 본문',
  questions: [1, 2].map((i) => ({
    id: `q${i}`,
    type: 'concept',
    prompt: '설명하라',
    expected_points: ['포인트 하나'],
    hint: '',
    solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
  })),
}

describe('ReviewSchema', () => {
  it('정상 응답을 통과시킨다', () => {
    expect(ReviewSchema.safeParse(validReview).success).toBe(true)
  })

  it('문제가 2개가 아니면 거른다', () => {
    const bad = { ...validReview, questions: validReview.questions.slice(0, 1) }
    expect(ReviewSchema.safeParse(bad).success).toBe(false)
  })

  it('★ expected_points 가 비면 거른다 — 복습도 채점 근거가 필요하다', () => {
    const bad = {
      ...validReview,
      questions: validReview.questions.map((q) => ({ ...q, expected_points: [] })),
    }
    expect(ReviewSchema.safeParse(bad).success).toBe(false)
  })
})

describe('StudyMaterial', () => {
  it('신규 콘텐츠를 공통 모양으로 좁힌다', () => {
    const m = materialOfContent(ContentSchema.parse(validContent))
    expect(m.title).toBe('HTTP 캐시')
    expect(m.questions).toHaveLength(3)
    expect(m.keyTerms).toHaveLength(1)
  })

  it('복습을 공통 모양으로 좁힌다 — 제목은 Topic 에서 온다', () => {
    const m = materialOfReview(ReviewSchema.parse(validReview), '배열')
    expect(m.title).toBe('배열')
    expect(m.bodyMd).toBe('되짚기 본문')
    expect(m.questions).toHaveLength(2)
    expect(m.keyTerms).toEqual([])
  })
})

const gradedTopic = {
  topic_id: 'cs.ds.array',
  questions: [1, 2, 3].map((i) => ({
    id: `q${i}`,
    correct_points: ['맞은 것'],
    missed_points: ['놓친 것'],
    misconceptions: [],
    feedback_ko: '두 문장이다. 이유도 적었다.',
  })),
  summary_seed: ['항목 1', '항목 2', '항목 3'],
  missing_prerequisites: [],
  weak_concepts: ['인덱스는 0부터'],
}

const validGrade = { topics: [gradedTopic] }

describe('GradeSchema', () => {
  it('정상 응답을 통과시킨다', () => {
    expect(GradeSchema.safeParse(validGrade).success).toBe(true)
  })

  it('★ snake_case 를 camelCase 로 옮긴다', () => {
    const g = GradeSchema.parse(validGrade)
    expect(g.topics[0]!.topicId).toBe('cs.ds.array')
    expect(g.topics[0]!.weakConcepts).toEqual(['인덱스는 0부터'])
    expect(g.topics[0]!.missingPrerequisites).toEqual([])
  })

  it('★ 여러 Topic 을 한 응답에 담는다 — 계획 단위 채점', () => {
    const two = { topics: [gradedTopic, { ...gradedTopic, topic_id: 'english.grammar.tense' }] }
    const g = GradeSchema.parse(two)
    expect(g.topics.map((t) => t.topicId))
      .toEqual(['cs.ds.array', 'english.grammar.tense'])
  })

  it('★ summary_seed 가 비면 거른다 — 정리본 화면이 이걸 쓴다', () => {
    const bad = { topics: [{ ...gradedTopic, summary_seed: [] }] }
    expect(GradeSchema.safeParse(bad).success).toBe(false)
  })

  it('Topic 이 하나도 없으면 거른다', () => {
    expect(GradeSchema.safeParse({ topics: [] }).success).toBe(false)
  })

  it('놓친 포인트가 없는 만점 답안도 통과시킨다', () => {
    const perfect = {
      topics: [{
        ...gradedTopic,
        questions: gradedTopic.questions.map((q) => ({ ...q, missed_points: [] })),
      }],
    }
    expect(GradeSchema.safeParse(perfect).success).toBe(true)
  })

  it('weak_concepts 가 비어 있어도 통과시킨다 — 힌트일 뿐이다', () => {
    const none = { topics: [{ ...gradedTopic, weak_concepts: [] }] }
    expect(GradeSchema.safeParse(none).success).toBe(true)
  })
})

/**
 * ★ 이 앱에서 가장 위험한 누출 지점이다.
 *
 * 모범답안이 학습 화면에 보이면 이 앱은 의미가 없다. 루브릭이 보이면
 * 답을 맞춰 쓸 수 있고, 힌트가 처음부터 보이면 힌트가 아니다.
 *
 * `publicQuestions` 가 그걸 막는 유일한 장치인데 **테스트가 하나도 없었다.**
 * 해설이 들어오면서 막을 것이 하나 더 늘었으므로 여기서 화이트리스트로
 * 잠근다 — 앞으로 문제에 무슨 필드를 더하든 이 테스트가 먼저 깨진다.
 */
describe('publicQuestions — 채점 전에 보여도 되는 것', () => {
  const material = materialOfContent(ContentSchema.parse(validContent))

  it('★ id · type · prompt 말고는 아무것도 나가지 않는다', () => {
    for (const q of publicQuestions(material)) {
      expect(Object.keys(q).sort()).toEqual(['id', 'prompt', 'type'])
    }
  })

  it('★ 해설이 새지 않는다', () => {
    const json = JSON.stringify(publicQuestions(material))
    expect(json).not.toContain('모범답안')
    expect(json).not.toContain('단계 하나')
    expect(json).not.toContain('근거 문장')
  })

  it('★ 루브릭과 힌트도 새지 않는다', () => {
    const json = JSON.stringify(publicQuestions(material))
    expect(json).not.toContain('포인트 하나')
    expect(json).not.toContain('힌트')
  })

  it('복습 자료도 같은 규칙이다', () => {
    const review = materialOfReview(ReviewSchema.parse(validReview), '제목')
    for (const q of publicQuestions(review)) {
      expect(Object.keys(q).sort()).toEqual(['id', 'prompt', 'type'])
    }
  })
})

describe('solutionsOf — 채점 뒤에만 쓰는 길', () => {
  const material = materialOfContent(ContentSchema.parse(validContent))

  it('문제 id 로 해설을 꺼낸다', () => {
    const s = solutionsOf(material)
    expect(Object.keys(s).sort()).toEqual(['q1', 'q2', 'q3'])
    expect(s.q1!.answer_md).toBe('모범답안')
    expect(s.q1!.steps).toEqual(['단계 하나'])
    expect(s.q1!.evidence).toBe('근거 문장')
  })

  it('힌트와 다른 길이다 — 이름이 하는 일을 드러내야 한다', () => {
    expect(hintFor(material, 'q1')).toBe('힌트')
    expect(solutionsOf(material).q1!.answer_md).not.toBe('힌트')
  })
})

describe('해설 스키마', () => {
  /** 해설만 떼어낸다. 구조분해로 버리면 안 쓰는 변수가 생겨 린트가 운다. */
  function withoutSolution(q: object): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...q }
    delete copy.solution
    return copy
  }

  it('★ 해설이 없는 응답은 거른다 — 조용히 비어 있으면 안 된다', () => {
    const missing = {
      ...validContent,
      questions: validContent.questions.map(withoutSolution),
    }
    expect(ContentSchema.safeParse(missing).success).toBe(false)
  })

  it('★ 모범답안이 비면 거른다', () => {
    const empty = {
      ...validContent,
      questions: validContent.questions.map((q) => ({
        ...q, solution: { ...q.solution, answer_md: '' },
      })),
    }
    expect(ContentSchema.safeParse(empty).success).toBe(false)
  })

  it('★ 풀이 단계가 비면 거른다 — 답만 주는 것은 해설이 아니다', () => {
    const empty = {
      ...validContent,
      questions: validContent.questions.map((q) => ({
        ...q, solution: { ...q.solution, steps: [] },
      })),
    }
    expect(ContentSchema.safeParse(empty).success).toBe(false)
  })

  it('지문 근거는 비어도 된다 — 지문 밖에서 생각해야 하는 문제가 있다', () => {
    const noEvidence = {
      ...validContent,
      questions: validContent.questions.map((q) => ({
        ...q, solution: { ...q.solution, evidence: '' },
      })),
    }
    expect(ContentSchema.safeParse(noEvidence).success).toBe(true)
  })

  it('복습 자료도 해설을 요구한다', () => {
    const missing = {
      ...validReview,
      questions: validReview.questions.map(withoutSolution),
    }
    expect(ReviewSchema.safeParse(missing).success).toBe(false)
  })
})
