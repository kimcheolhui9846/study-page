import { describe, it, expect } from 'vitest'
import {
  ChatGen, FeedbackGen, MaterialGen, StartGen,
  chatJsonSchema, feedbackJsonSchema, materialJsonSchema, startJsonSchema,
  StoredMaterialContent, StoredProblemPrivate, StoredProblemPublic,
  PUBLIC_PROBLEM_KEYS, publicProblem, splitProblem,
} from '../../lib/study/schemas'

const PROBLEM = {
  prompt_md: '그래프에서 최단 거리를 구하라',
  kind: 'code' as const,
  spec: { input_md: 'N M', output_md: '거리', constraints_md: 'N ≤ 10^5', examples_md: '1 2 → 1' },
  answer_md: 'SECRET-ANSWER',
  rubric: ['SECRET-RUBRIC'],
  solution_md: 'SECRET-SOLUTION',
  hints: ['힌트1', '힌트2', '힌트3'],
}

const MATERIAL = {
  title: 'BFS 입문',
  activity: 'problem',
  blocks: [{ kind: 'explain', title: '개념', body_md: 'BFS 는 큐를 쓴다' }],
  problems: [PROBLEM],
}

/** strict 모드 규칙: 모든 object 는 additionalProperties:false, required = 모든 키 */
function assertStrict(node: unknown, path = '$'): void {
  if (Array.isArray(node)) { node.forEach((n, i) => assertStrict(n, `${path}[${i}]`)); return }
  if (typeof node !== 'object' || node === null) return
  const o = node as Record<string, unknown>
  if (o.type === 'object') {
    expect(o.additionalProperties, path).toBe(false)
    expect([...(o.required as string[])].sort(), path)
      .toEqual(Object.keys(o.properties as object).sort())
  }
  for (const [k, v] of Object.entries(o)) assertStrict(v, `${path}.${k}`)
}

function row(over: Partial<{ hintsRevealed: number; solutionRevealed: boolean }> = {}) {
  const { pub, priv } = splitProblem(PROBLEM)
  return {
    id: 7, number: 2, public: pub, private: priv,
    hintsRevealed: 0, solutionRevealed: false, ...over,
  }
}

describe('생성 스키마', () => {
  it('자료를 받는다', () => {
    expect(MaterialGen.safeParse(MATERIAL).success).toBe(true)
  })

  it('★ 힌트는 정확히 세 단계다', () => {
    const bad = { ...MATERIAL, problems: [{ ...PROBLEM, hints: ['하나'] }] }
    expect(MaterialGen.safeParse(bad).success).toBe(false)
  })

  it('★ 시작 응답이 material 인데 자료 블록이 비면 거절한다', () => {
    const empty = { ...MATERIAL, blocks: [], problems: [] }
    expect(StartGen.safeParse({
      outcome: 'material', clarify_question: '', material: empty,
    }).success).toBe(false)
    expect(StartGen.safeParse({
      outcome: 'clarify', clarify_question: '어느 범위?', material: empty,
    }).success).toBe(true)
  })

  it('대화 응답의 의도는 네 가지다', () => {
    const ok = { reply_md: 'a', intent: 'answer', problem_number: 0, material_instruction: '', note: '' }
    expect(ChatGen.safeParse(ok).success).toBe(true)
    expect(ChatGen.safeParse({ ...ok, intent: 'run_code' }).success).toBe(false)
  })

  it('피드백은 verdict 세 값을 받는다', () => {
    const fb = {
      verdict: 'partial', summary_md: 's', issues: [{ where: 'L3', why: 'w', fix_hint: 'h' }],
      correct_points: [], missed_points: [], improved_md: '',
    }
    expect(FeedbackGen.safeParse(fb).success).toBe(true)
    expect(FeedbackGen.safeParse({ ...fb, verdict: 'AC' }).success).toBe(false)
  })

  it.each([
    ['start', startJsonSchema],
    ['chat', chatJsonSchema],
    ['material', materialJsonSchema],
    ['feedback', feedbackJsonSchema],
  ])('★ %s JSON Schema 가 strict 규칙을 지킨다', (_n, schema) => {
    assertStrict(schema)
  })
})

describe('저장 스키마 — 옛 자료도 견딘다', () => {
  it('필드가 빠져도 읽는다', () => {
    expect(StoredMaterialContent.safeParse({ title: 't' }).success).toBe(true)
    expect(StoredProblemPublic.safeParse({ prompt_md: 'p' }).success).toBe(true)
    expect(StoredProblemPrivate.safeParse({}).success).toBe(true)
  })

  it('모르는 필드가 있어도 읽는다', () => {
    expect(StoredMaterialContent.safeParse({ title: 't', future: 1 }).success).toBe(true)
  })
})

describe('공개 투영', () => {
  it('★ 키가 화이트리스트와 정확히 같다', () => {
    expect(Object.keys(publicProblem(row())).sort()).toEqual([...PUBLIC_PROBLEM_KEYS].sort())
  })

  it('★ 공개 전에는 정답·루브릭·해설 문자열이 어디에도 없다', () => {
    const text = JSON.stringify(publicProblem(row({ hintsRevealed: 3 })))
    for (const secret of ['SECRET-ANSWER', 'SECRET-RUBRIC', 'SECRET-SOLUTION']) {
      expect(text).not.toContain(secret)
    }
  })

  it('힌트는 공개한 만큼만 보인다', () => {
    const p = publicProblem(row({ hintsRevealed: 1 }))
    expect(p.hints).toEqual(['힌트1'])
    expect(p.hintsLeft).toBe(2)
  })

  it('해설은 공개한 뒤에만 보인다 — 루브릭은 끝까지 안 보인다', () => {
    const p = publicProblem(row({ solutionRevealed: true }))
    expect(p.solution).toEqual({ answer_md: 'SECRET-ANSWER', solution_md: 'SECRET-SOLUTION' })
    expect(JSON.stringify(p)).not.toContain('SECRET-RUBRIC')
  })

  it('입출력 형식이 전부 비면 spec 은 null 이다', () => {
    const { pub, priv } = splitProblem({
      ...PROBLEM, spec: { input_md: '', output_md: '', constraints_md: '', examples_md: '' },
    })
    expect(publicProblem({ ...row(), public: pub, private: priv }).spec).toBeNull()
  })
})
