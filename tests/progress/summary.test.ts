import { describe, it, expect } from 'vitest'
import { loadGraph } from '../../lib/curriculum/load'
import {
  subjectProgress, streakDays, paceOf, recentScores, reviewLoad,
  MIN_DAYS_TO_ESTIMATE,
} from '../../lib/progress/summary'
import type { MasteryStatus } from '../../lib/mastery/transition'
import type { ProgressState } from '../../lib/plan/types'

const graph = loadGraph()

function progress(
  entries: Array<{ id: string; status: MasteryStatus; nextReviewAt?: string | null }>,
) {
  const m = new Map<string, ProgressState>()
  for (const e of entries) {
    m.set(e.id, {
      topicId: e.id,
      status: e.status,
      masteryScore: e.status === 'mastered' ? 90 : 40,
      attemptCount: 1,
      wrongCount: 0,
      nextReviewAt: e.nextReviewAt ?? null,
      reviewRound: 1,
      lastStudiedAt: '2026-09-01',
      weakConcepts: [],
    })
  }
  return m
}

describe('과목별 진도', () => {
  it('아무것도 안 했으면 전부 not_started 다', () => {
    const rows = subjectProgress(graph, 90, new Map())
    for (const r of rows) {
      expect(r.mastered).toBe(0)
      expect(r.percent).toBe(0)
      expect(r.notStarted).toBe(r.total)
    }
  })

  it('상태별로 나눠 센다', () => {
    const p = progress([
      { id: 'cs.prog.variables-types', status: 'mastered' },
      { id: 'cs.ds.array', status: 'weak' },
      { id: 'cs.prog.control-flow', status: 'learning' },
    ])
    const cs = subjectProgress(graph, 90, p).find((r) => r.subject === 'cs')!

    expect(cs.mastered).toBe(1)
    expect(cs.weak).toBe(1)
    expect(cs.inProgress).toBe(1)
    expect(cs.mastered + cs.weak + cs.inProgress + cs.notStarted).toBe(cs.total)
  })

  it('★ 진도는 분이 아니라 Topic 개수로 센다 — 분은 추정치고 개수는 사실이다', () => {
    const cs = subjectProgress(graph, 90, new Map()).find((r) => r.subject === 'cs')!
    const p = progress([{ id: 'cs.prog.variables-types', status: 'mastered' }])
    const after = subjectProgress(graph, 90, p).find((r) => r.subject === 'cs')!

    expect(after.percent).toBe(Math.round((1 / cs.total) * 100))
  })

  it('reviewing 은 진행 중으로 본다 — 숙달했다가 흔들린 것도 아직 진행 중이다', () => {
    const p = progress([{ id: 'cs.ds.array', status: 'reviewing' }])
    const cs = subjectProgress(graph, 90, p).find((r) => r.subject === 'cs')!
    expect(cs.inProgress).toBe(1)
    expect(cs.mastered).toBe(0)
  })

  it('목표 기간이 짧으면 분모가 준다 — core 만 담기므로', () => {
    const short = subjectProgress(graph, 30, new Map())
    const long = subjectProgress(graph, 90, new Map())
    const sum = (rows: typeof short) => rows.reduce((n, r) => n + r.total, 0)
    expect(sum(short)).toBeLessThan(sum(long))
  })
})

describe('연속 학습일', () => {
  it('오늘까지 이어지면 오늘을 포함해 센다', () => {
    expect(streakDays(['2026-08-31', '2026-09-01', '2026-09-02'], '2026-09-02')).toBe(3)
  })

  it('★ 오늘 아직 안 했다고 끊기지 않는다 — 하루가 아직 안 끝났다', () => {
    expect(streakDays(['2026-08-31', '2026-09-01'], '2026-09-02')).toBe(2)
  })

  it('어제도 안 했으면 0 이다', () => {
    expect(streakDays(['2026-08-30', '2026-08-31'], '2026-09-02')).toBe(0)
  })

  it('중간이 비면 거기서 끊는다', () => {
    expect(streakDays(['2026-08-28', '2026-09-01', '2026-09-02'], '2026-09-02')).toBe(2)
  })

  it('한 번도 안 했으면 0 이다', () => {
    expect(streakDays([], '2026-09-02')).toBe(0)
  })

  it('오늘 처음 했으면 1 이다', () => {
    expect(streakDays(['2026-09-02'], '2026-09-02')).toBe(1)
  })

  it('같은 날이 여러 번 들어와도 하루로 센다', () => {
    expect(streakDays(['2026-09-02', '2026-09-02', '2026-09-01'], '2026-09-02')).toBe(2)
  })

  it('달을 넘어도 이어진다', () => {
    expect(streakDays(['2026-08-31', '2026-09-01'], '2026-09-01')).toBe(2)
  })
})

describe('예상 완료일', () => {
  const base = { totalTopics: 60, today: '2026-09-02' }

  it('★ 표본이 적으면 예측하지 않는다 — 모른다고 말하는 편이 낫다', () => {
    const p = paceOf({ ...base, activeDays: MIN_DAYS_TO_ESTIMATE - 1, masteredTopics: 4 })
    expect(p.estimatedDays).toBeNull()
    expect(p.estimatedDate).toBeNull()
  })

  it('★ 목표에서 역산하지 않는다 — 실제 속도로 잰다', () => {
    // 10일 동안 20개 = 하루 2개. 남은 40개면 20일.
    const p = paceOf({ ...base, activeDays: 10, masteredTopics: 20 })
    expect(p.perDay).toBe(2)
    expect(p.remaining).toBe(40)
    expect(p.estimatedDays).toBe(20)
    expect(p.estimatedDate).toBe('2026-09-22')
  })

  it('하나도 못 넘겼으면 예측하지 않는다 — 0 으로 나눌 수 없다', () => {
    const p = paceOf({ ...base, activeDays: 10, masteredTopics: 0 })
    expect(p.estimatedDays).toBeNull()
  })

  it('다 끝냈으면 남은 날이 0 이다', () => {
    const p = paceOf({ ...base, activeDays: 30, masteredTopics: 60 })
    expect(p.remaining).toBe(0)
    expect(p.estimatedDays).toBe(0)
  })

  it('숙달이 총량을 넘어도 음수가 되지 않는다', () => {
    // 커리큘럼에서 Topic 이 빠지면 생길 수 있다
    const p = paceOf({ ...base, activeDays: 30, masteredTopics: 70 })
    expect(p.remaining).toBe(0)
  })

  it('느린 속도는 올림한다 — 남은 날을 낙관하지 않는다', () => {
    // 3일에 1개 = 하루 0.333개. 남은 59개면 177일.
    const p = paceOf({ ...base, activeDays: 3, masteredTopics: 1 })
    expect(p.estimatedDays).toBe(177)
  })
})

describe('최근 점수', () => {
  const graded = [
    { topicId: 'cs.prog.variables-types', score: 94, studyDate: '2026-09-02' },
    { topicId: 'english.grammar.sentence-structure', score: 81, studyDate: '2026-09-02' },
    { topicId: 'cs.ds.array', score: 55, studyDate: '2026-08-30' },
  ]

  it('새 것부터 준다', () => {
    const rows = recentScores(graph, graded)
    expect(rows[0]!.studyDate).toBe('2026-09-02')
    expect(rows.at(-1)!.studyDate).toBe('2026-08-30')
  })

  it('제목과 과목을 붙인다', () => {
    const rows = recentScores(graph, graded)
    expect(rows[0]!.title).toBe(graph.topics.get(rows[0]!.topicId)!.title)
    expect(rows[0]!.subject).toBe(graph.topics.get(rows[0]!.topicId)!.subject)
  })

  it('★ 커리큘럼에서 사라진 Topic 은 뺀다 — 제목을 붙일 수 없다', () => {
    const rows = recentScores(graph, [
      ...graded, { topicId: 'cs.없음.없음', score: 70, studyDate: '2026-09-02' },
    ])
    expect(rows.map((r) => r.topicId)).not.toContain('cs.없음.없음')
  })

  it('개수를 자른다', () => {
    expect(recentScores(graph, graded, 2)).toHaveLength(2)
  })

  it('빈 목록도 터지지 않는다', () => {
    expect(recentScores(graph, [])).toEqual([])
  })
})

describe('복습 부담', () => {
  const today = '2026-09-02'

  it('기한이 된 것과 다가오는 것을 나눈다', () => {
    const p = progress([
      { id: 'cs.ds.array', status: 'mastered', nextReviewAt: '2026-09-01' },
      { id: 'cs.prog.variables-types', status: 'mastered', nextReviewAt: '2026-09-02' },
      { id: 'cs.prog.control-flow', status: 'mastered', nextReviewAt: '2026-09-05' },
      { id: 'cs.prog.functions', status: 'mastered', nextReviewAt: '2026-10-01' },
    ])
    const load = reviewLoad(p, today)

    // 어제 기한 + 오늘 기한 = 2
    expect(load.due).toBe(2)
    expect(load.upcoming).toBe(1)
  })

  it('예약이 없는 Topic 은 세지 않는다', () => {
    const p = progress([{ id: 'cs.ds.array', status: 'learning', nextReviewAt: null }])
    expect(reviewLoad(p, today)).toEqual({ due: 0, upcoming: 0 })
  })

  it('창을 넓히면 더 담긴다', () => {
    const p = progress([{ id: 'cs.ds.array', status: 'mastered', nextReviewAt: '2026-09-20' }])
    expect(reviewLoad(p, today, 7).upcoming).toBe(0)
    expect(reviewLoad(p, today, 30).upcoming).toBe(1)
  })
})
