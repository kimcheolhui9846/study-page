import { describe, it, expect } from 'vitest'
import {
  contentSystem, REVIEW_SYSTEM, GRADE_SYSTEM,
  contentUserMessage, gradeUserMessage, type GradeTarget,
} from '../../lib/llm/prompts'
import { buildTopicContext, knownQuestionTypes } from '../../lib/llm/context'
import { TOPIC_KINDS } from '../../lib/curriculum/schema'
import { loadGraph } from '../../lib/curriculum/load'
import type { StudyMaterial } from '../../lib/llm/schemas'

const graph = loadGraph()
const topic = graph.topics.get('cs.os.process-thread')!

const ctx = buildTopicContext(graph, topic, {
  mode: 'new', reviewRound: null, minutes: 30, progress: new Map(),
})

const CONTENT_SYSTEM = contentSystem('concept')

/** 공통 규칙만 해도 이 길이는 넘는다. 레시피가 빈 문자열이면 여기서 걸린다. */
const CONTENT_BASE_MIN = 600

/**
 * ★ 실호출 표본 3개가 전부 존댓말로 나왔다. 앱의 다른 모든 문장은 평서체라서
 * 지문만 존댓말이면 한 화면에 목소리가 둘이 된다.
 *
 * 이 테스트가 지키는 것은 "프롬프트가 문체를 말하는가"까지다. 모델이 실제로
 * 지키는지는 실호출로만 알 수 있다 — 테스트에서 LLM 을 부르지 않기 때문이다.
 */
describe('문체 규칙', () => {
  const prompts = { CONTENT_SYSTEM, REVIEW_SYSTEM, GRADE_SYSTEM }

  it('★ 세 프롬프트 모두 평서체를 요구한다', () => {
    for (const [name, prompt] of Object.entries(prompts)) {
      expect(prompt, name).toContain('문체는 평서체다')
    }
  })

  it('★ 금지할 존댓말 어미를 하나하나 적는다 — "평서체로 써라"만으로는 안 지킨다', () => {
    for (const [name, prompt] of Object.entries(prompts)) {
      for (const ending of ['~합니다', '~입니다', '~하세요']) {
        expect(prompt, `${name} 에 ${ending}`).toContain(ending)
      }
    }
  })

  it('고쳐 쓴 예시를 준다', () => {
    expect(CONTENT_SYSTEM).toContain('→ "변수는 값에 붙인 이름이다"')
  })

  it('문제는 "~하라"로 쓰라고 한다 — "~하시오"가 실제로 나왔다', () => {
    expect(CONTENT_SYSTEM).toContain('"~하라"')
    expect(CONTENT_SYSTEM).toContain('"~하시오"')
  })

  it('★ 프롬프트 자신도 평서체다 — 시키는 문체로 쓰여 있어야 한다', () => {
    for (const [name, prompt] of Object.entries(prompts)) {
      // 큰따옴표 안은 금지 표현을 인용한 예시다. 그걸 걷어낸 나머지를 본다.
      const withoutExamples = prompt.replace(/"[^"]*"/g, '')
      expect(withoutExamples, name).not.toMatch(/합니다|입니다|하세요/)
    }
  })
})

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

  it('본문에 답을 노출하지 말라고 한다', () => {
    expect(CONTENT_SYSTEM).toContain('답을 본문에 그대로 노출하지 마라')
  })

  it('★ 금지어를 언급조차 하지 말라고 한다 — 커리큘럼 순서를 지키는 장치다', () => {
    expect(CONTENT_SYSTEM).toContain('아직 배우지 않은 것')
    expect(CONTENT_SYSTEM).toContain('이름을 언급하는 것도 안 된다')
  })

  it('이미 배운 것을 다시 설명하지 말라고 한다', () => {
    expect(CONTENT_SYSTEM).toContain('다시 설명하지 마라')
  })
})

describe('REVIEW_SYSTEM', () => {
  it('★ 처음부터 다시 가르치지 말라고 한다 — 복습은 재독이 아니다', () => {
    expect(REVIEW_SYSTEM).toContain('처음부터 다시 가르치지 마라')
  })

  it('복습 문제는 2개다', () => {
    expect(REVIEW_SYSTEM).toContain('정확히 2개')
  })

  it('지난번과 같은 문제를 금지한다', () => {
    expect(REVIEW_SYSTEM).toContain('같은 문제를 내지 마라')
  })

  it('회차가 오를수록 어려워진다고 못박는다', () => {
    expect(REVIEW_SYSTEM).toContain('회차가 올라갈수록')
  })

  it('신규와 같은 공통 규칙을 공유한다', () => {
    for (const rule of ['검증 가능한 한 문장', '아직 배우지 않은 것', 'KaTeX']) {
      expect(REVIEW_SYSTEM).toContain(rule)
      expect(CONTENT_SYSTEM).toContain(rule)
    }
  })
})

describe('GRADE_SYSTEM', () => {
  it('★ 루브릭 밖의 기준을 금지한다 — 재현 가능한 채점의 근거다', () => {
    expect(GRADE_SYSTEM).toContain('루브릭에 없는 기준으로 채점하지 마라')
  })

  it('★ 점수를 매기지 말라고 한다 — 2주차에 모델이 자기 계산식을 어겼다', () => {
    expect(GRADE_SYSTEM).toContain('점수를 매기지 마라')
  })

  it('포인트 개수가 보존되어야 한다고 못박는다 — 점수의 분모다', () => {
    expect(GRADE_SYSTEM).toContain('채점 포인트 개수와 같아야 한다')
  })

  it('칭찬으로 시작하지 말라고 한다', () => {
    expect(GRADE_SYSTEM).toContain('칭찬으로 문장을 시작하지 마라')
  })

  it('표현이 달라도 의미가 같으면 맞다고 한다', () => {
    expect(GRADE_SYSTEM).toContain('표현이 달라도 의미가 같으면')
  })

  it('★ 주제끼리 서로 영향을 주지 말라고 한다 — 한 번에 여러 개를 채점하므로', () => {
    expect(GRADE_SYSTEM).toContain('주제마다 독립적으로 채점해라')
  })
})

describe('contentUserMessage', () => {
  it('Topic 의 메타데이터를 담는다', () => {
    const msg = contentUserMessage(ctx)
    expect(msg).toContain(topic.title)
    expect(msg).toContain(topic.goal)
    expect(msg).toContain(topic.domainLabel)
    expect(msg).toContain(topic.keywords[0]!)
    expect(msg).toContain(String(topic.difficulty))
  })

  it('★ 계획이 정한 분량을 담는다 — Topic 의 기본값이 아니라', () => {
    expect(contentUserMessage(ctx)).toContain('30분')
  })

  it('★ Day 번호를 담지 않는다 — 몇 번째 날인지는 사용자마다 다르다', () => {
    expect(contentUserMessage(ctx)).not.toContain('Day')
  })
})

const material = (): StudyMaterial => ({
  title: '프로세스와 스레드',
  bodyMd: '본문',
  keyTerms: [],
  questions: [{
    id: 'q1', type: 'concept', prompt: '설명하라',
    expected_points: ['포인트 A', '포인트 B'], hint: '이건 힌트다',
    solution: { answer_md: '모범답안', steps: ['단계 하나'], evidence: '근거 문장' },
  }],
})

const target = (answers: Record<string, string>): GradeTarget => ({
  topicId: topic.id,
  title: topic.title,
  goal: topic.goal,
  material: material(),
  answers,
})

describe('gradeUserMessage', () => {
  it('★ 루브릭을 담는다 — 이게 없으면 채점이 매번 달라진다', () => {
    const msg = gradeUserMessage([target({ q1: '내 답' })])
    expect(msg).toContain('포인트 A')
    expect(msg).toContain('포인트 B')
  })

  it('학습자 답안을 담는다', () => {
    expect(gradeUserMessage([target({ q1: '내 답' })])).toContain('내 답')
  })

  it('★ 힌트를 담지 않는다 — 채점과 무관한 토큰이다', () => {
    expect(gradeUserMessage([target({ q1: '내 답' })])).not.toContain('이건 힌트다')
  })

  it('★ 지문 본문을 담지 않는다 — 루브릭이 이미 기준이다', () => {
    expect(gradeUserMessage([target({ q1: '내 답' })])).not.toContain('본문')
  })

  it('답을 안 쓴 문제는 빈 답으로 표시한다', () => {
    expect(gradeUserMessage([target({})])).toContain('(답을 쓰지 않음)')
  })

  it('공백만 쓴 답도 빈 답으로 본다', () => {
    expect(gradeUserMessage([target({ q1: '   \n ' })])).toContain('(답을 쓰지 않음)')
  })

  it('goal 을 담는다 — 채점의 기준선이다', () => {
    expect(gradeUserMessage([target({ q1: 'x' })])).toContain(topic.goal)
  })

  it('★ 여러 Topic 을 한 메시지에 담는다 — 하루 채점은 1회 호출이다', () => {
    const two = [
      target({ q1: '첫 답' }),
      { ...target({ q1: '둘째 답' }), topicId: 'english.grammar.tense', title: '시제' },
    ]
    const msg = gradeUserMessage(two)
    expect(msg).toContain('아래 2개 주제')
    expect(msg).toContain('topic_id: cs.os.process-thread')
    expect(msg).toContain('topic_id: english.grammar.tense')
    expect(msg).toContain('첫 답')
    expect(msg).toContain('둘째 답')
  })

  it('★ topic_id 를 그대로 쓰라고 지시한다 — 응답을 항목에 다시 붙여야 한다', () => {
    expect(gradeUserMessage([target({ q1: 'x' })]))
      .toContain('그대로 써라')
  })
})

/**
 * ★ 커리큘럼은 `kind: vocabulary` · `kind: reading` 을 진작 달아뒀는데
 * 코드가 그 필드를 읽지 않아 65개 Topic 전부가 개념 레시피로 나갔다.
 *
 * 여기서 지키는 것은 "성격마다 다른 것을 시키는가"다.
 */
describe('Topic 성격별 레시피', () => {
  it('★ 모든 성격에 레시피가 있다 — 없으면 조용히 엉뚱한 자료가 나온다', () => {
    for (const kind of TOPIC_KINDS) {
      const prompt = contentSystem(kind)
      expect(prompt.length, kind).toBeGreaterThan(CONTENT_BASE_MIN)
      expect(prompt, kind).toContain('문체는 평서체다') // 공통 규칙은 전부 갖는다
    }
  })

  it('★ 성격마다 실제로 다른 것을 시킨다', () => {
    const recipes = TOPIC_KINDS.map((k) => contentSystem(k))
    expect(new Set(recipes).size).toBe(TOPIC_KINDS.length)
  })

  it('★ 어휘는 개념 레시피를 받지 않는다', () => {
    const vocab = contentSystem('vocabulary')
    // 개념 레시피의 문제 구성이 어휘로 새면 안 된다
    expect(vocab).not.toContain('recall 1개, concept 1개, application 1개')
    expect(vocab).not.toContain('정의 → 왜 그런가 → 구체 예시')
    expect(vocab).toContain('단어에 대한 설명문을 쓰지 마라')
  })

  it('★ 어휘와 독해는 영어 지문을 요구한다 — 한국어 설명문이 아니다', () => {
    expect(contentSystem('vocabulary')).toContain('지문은 **영어**로 쓴다')
    expect(contentSystem('reading')).toContain('지문은 **영어**로 쓴다')
  })

  it('독해는 번역을 금지한다 — 번역이 있으면 아무도 영어를 읽지 않는다', () => {
    expect(contentSystem('reading')).toContain('한국어 번역을 붙이지 마라')
  })

  it('개념 레시피는 그대로다', () => {
    expect(contentSystem('concept')).toContain('정확히 3개')
    expect(contentSystem('concept')).toContain('recall')
    expect(contentSystem('concept')).toContain('application')
  })
})

describe('실제 커리큘럼과의 정합', () => {
  it('★ 커리큘럼이 쓰는 문제 유형이 전부 사전에 있다', () => {
    /*
     * 사전에 없는 슬러그는 조용히 버려진다 — 그 Topic 만 유형 지시를 잃는데
     * 아무 신호도 안 난다. 오타든 새 유형이든 여기서 걸린다.
     */
    const known = knownQuestionTypes()
    const unknown = new Set<string>()

    for (const t of graph.topics.values()) {
      for (const q of t.questionTypes) if (!known.has(q)) unknown.add(q)
    }

    expect([...unknown]).toEqual([])
  })

  it('★ 어휘·독해 Topic 이 실제로 다른 프롬프트를 받는다', () => {
    const byKind = new Map<string, string[]>()
    for (const t of graph.topics.values()) {
      byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t.id])
    }

    // 커리큘럼에 어휘와 독해가 실제로 있다 (없으면 이 테스트가 무의미하다)
    expect(byKind.get('vocabulary')?.length).toBeGreaterThan(0)
    expect(byKind.get('reading')?.length).toBeGreaterThan(0)

    for (const [kind, ids] of byKind) {
      for (const id of ids) {
        const t = graph.topics.get(id)!
        expect(contentSystem(t.kind), id).toBe(contentSystem(kind as typeof t.kind))
      }
    }
  })
})

describe('해설 지시', () => {
  it('★ 네 성격 모두 해설을 요구한다', () => {
    for (const kind of TOPIC_KINDS) {
      expect(contentSystem(kind), kind).toContain('solution 은 채점을 받은 뒤에만')
    }
  })

  it('복습에도 해설이 필요하다 — 오히려 더 필요하다', () => {
    expect(REVIEW_SYSTEM).toContain('solution 은 채점을 받은 뒤에만')
  })

  it('세 조각을 각각 지시한다', () => {
    const p = contentSystem('concept')
    expect(p).toContain('answer_md')
    expect(p).toContain('steps')
    expect(p).toContain('evidence')
  })

  it('★ 루브릭을 다시 나열하지 말라고 못박는다', () => {
    // 그러지 않으면 expected_points 를 그대로 옮겨 적는다. 그건 해설이 아니다.
    expect(contentSystem('concept')).toContain('루브릭을 다시 나열하지 마라')
  })

  it('지문 근거는 요약이 아니라 그대로 옮기게 한다', () => {
    expect(contentSystem('concept')).toContain('그대로** 옮긴다')
  })

  it('★ 채점은 학습자가 쓴 문장을 인용하게 한다', () => {
    // 「~가 빠졌다」로 끝나면 무엇을 고쳐야 할지 알 수 없다.
    expect(GRADE_SYSTEM).toContain('학습자가 쓴 문장을 직접 인용')
  })
})
