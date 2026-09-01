import { describe, it, expect } from 'vitest'
import {
  CONTENT_SYSTEM, GRADE_SYSTEM, contentUserMessage, gradeUserMessage,
} from '../../lib/llm/prompts'
import { loadGraph } from '../../lib/curriculum/load'

const topic = loadGraph().topics.get('cs.os.process-thread')!

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

  it('지문에 답을 노출하지 말라고 한다', () => {
    expect(CONTENT_SYSTEM).toContain('답을 그대로 노출하지 마라')
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

  it('표현이 달라도 의미가 같으면 맞다고 한다', () => {
    expect(GRADE_SYSTEM).toContain('표현이 달라도 의미가 같으면')
  })
})

describe('contentUserMessage', () => {
  it('Topic 의 메타데이터를 담는다', () => {
    const msg = contentUserMessage(topic)
    expect(msg).toContain(topic.title)
    expect(msg).toContain(topic.goal)
    expect(msg).toContain(topic.domainLabel)
    expect(msg).toContain(topic.keywords[0])
    expect(msg).toContain(String(topic.difficulty))
    expect(msg).toContain(String(topic.estimatedMinutes))
  })

  it('★ Day 번호를 담지 않는다 — 몇 번째 날인지는 사용자마다 다르다', () => {
    expect(contentUserMessage(topic)).not.toContain('Day')
  })
})

describe('gradeUserMessage', () => {
  const questions = [
    {
      id: 'q1' as const, type: 'concept' as const, prompt: '설명하라',
      expected_points: ['포인트 A', '포인트 B'], hint: '이건 힌트다',
    },
  ]

  it('★ 루브릭을 담는다 — 이게 없으면 채점이 매번 달라진다', () => {
    const msg = gradeUserMessage(topic, questions, { q1: '내 답' })
    expect(msg).toContain('포인트 A')
    expect(msg).toContain('포인트 B')
  })

  it('학습자 답안을 담는다', () => {
    expect(gradeUserMessage(topic, questions, { q1: '내 답' })).toContain('내 답')
  })

  it('★ 힌트를 담지 않는다 — 채점과 무관한 토큰이다', () => {
    expect(gradeUserMessage(topic, questions, { q1: '내 답' })).not.toContain('이건 힌트다')
  })

  it('답을 안 쓴 문제는 빈 답으로 표시한다', () => {
    expect(gradeUserMessage(topic, questions, {})).toContain('(답을 쓰지 않음)')
  })

  it('공백만 쓴 답도 빈 답으로 본다', () => {
    expect(gradeUserMessage(topic, questions, { q1: '   \n ' })).toContain('(답을 쓰지 않음)')
  })

  it('goal 을 담는다 — goal_reached 판정의 근거다', () => {
    expect(gradeUserMessage(topic, questions, { q1: 'x' })).toContain(topic.goal)
  })

  it('★ 지문 본문을 담지 않는다 — 루브릭이 이미 기준이다', () => {
    // 지문을 넘기지 않으므로 애초에 들어갈 수 없다. 시그니처가 그것을 강제한다.
    expect(gradeUserMessage(topic, questions, { q1: 'x' }).length).toBeLessThan(600)
  })
})
