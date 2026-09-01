/**
 * 채점 근거를 숙련도 점수로 바꾼다.
 *
 * ★ 모델이 준 score 필드를 쓰지 않는다. 2주차에 확인했다 — 프롬프트가
 * 계산식을 명시해도 지키지 않고, 포인트를 전부 놓친 답에 50점을 줬다.
 * 모델은 "무엇을 맞고 무엇을 놓쳤나"만 대고, 숫자는 여기서 만든다.
 * 그래야 화면과 루브릭이 항상 일치한다.
 */

export interface ScoreInput {
  /** 채점이 판정한 맞은 포인트 수 */
  correctPoints: number
  /** 놓친 포인트 수 */
  missedPoints: number
  /** Topic 난이도 1~5 */
  difficulty: number
  /** 힌트를 봤는가 */
  usedHint: boolean
  /** 이 Topic 을 전에도 틀린 적이 있는가 */
  repeatedMistake: boolean
  /** 이전 숙련도. 없으면 첫 학습이다 */
  previousScore?: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * 포인트 비율에서 출발해 보정한다.
 *
 * 보정의 방향이 중요하다:
 *   - 힌트를 봤으면 낮춘다. 스스로 떠올린 것과 같게 볼 수 없다
 *   - 반복해 틀렸으면 낮춘다. 이번에 맞았어도 아직 굳지 않았다
 *   - 어려운 문제를 맞히면 올린다. 난이도 5를 맞히는 것은 1을 맞히는 것과 다르다
 *
 * 이전 점수가 있으면 섞는다. **한 번의 실수로 숙달이 무너지지 않게** 한다 —
 * 컨디션 나쁜 하루가 두 달치 학습을 지우면 안 된다.
 */
export function masteryScore(input: ScoreInput): number {
  const total = input.correctPoints + input.missedPoints
  // 채점이 포인트를 하나도 못 냈으면 판단할 근거가 없다. 0 이 아니라 미평가다.
  if (total === 0) return input.previousScore ?? 0

  const raw = input.correctPoints / total

  let factor = 1
  if (input.usedHint) factor *= 0.9
  if (input.repeatedMistake) factor *= 0.95
  factor *= 0.9 + 0.04 * clamp(input.difficulty, 1, 5)

  const fresh = clamp(Math.round(raw * 100 * factor), 0, 100)

  if (input.previousScore === undefined) return fresh
  return clamp(Math.round(input.previousScore * 0.4 + fresh * 0.6), 0, 100)
}

/**
 * 채점 응답에서 점수 계산에 필요한 것만 뽑는다.
 *
 * `per_question` 을 합산한다 — 문제별로 나누지 않고 Topic 하나의 숙련도를
 * 낸다. 문제 셋이 같은 goal 을 향하므로 따로 셀 이유가 없다.
 */
export interface QuestionFeedback {
  correct_points: string[]
  missed_points: string[]
}

export function countPoints(perQuestion: QuestionFeedback[]): {
  correctPoints: number
  missedPoints: number
} {
  return {
    correctPoints: perQuestion.reduce((n, q) => n + q.correct_points.length, 0),
    missedPoints: perQuestion.reduce((n, q) => n + q.missed_points.length, 0),
  }
}
