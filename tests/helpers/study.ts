/** 자유학습 테스트의 공용 고정값. 비밀 문자열은 누출 검사에 쓰려고 눈에 띄게 둔다 */

export function problem(n: number, over: Record<string, unknown> = {}) {
  return {
    prompt_md: `PROMPT-${n}`,
    kind: 'code' as const,
    spec: { input_md: 'N M', output_md: '거리', constraints_md: 'N ≤ 10^5', examples_md: '1 2 → 1' },
    answer_md: `SECRET-ANSWER-${n}`,
    rubric: [`SECRET-RUBRIC-${n}a`, `SECRET-RUBRIC-${n}b`],
    solution_md: `SECRET-SOLUTION-${n}`,
    hints: [`HINT-${n}-1`, `HINT-${n}-2`, `HINT-${n}-3`],
    ...over,
  }
}

export function material(title: string, problemCount: number, start = 1) {
  return {
    title,
    activity: 'problem',
    blocks: [{ kind: 'explain' as const, title: '개념', body_md: `BODY-${title}` }],
    problems: Array.from({ length: problemCount }, (_, i) => problem(start + i)),
  }
}

export const SECRETS = /SECRET-(ANSWER|RUBRIC|SOLUTION)/

export function startPayload(title = '자료', count = 3) {
  return { outcome: 'material', clarify_question: '', material: material(title, count) }
}

export function chatPayload(over: Record<string, unknown> = {}) {
  return {
    reply_md: '답변이다', intent: 'answer', problem_number: 0,
    material_instruction: '', note: '', ...over,
  }
}

export function feedbackPayload(over: Record<string, unknown> = {}) {
  return {
    verdict: 'partial',
    summary_md: '요약',
    issues: [{ where: '3번째 줄', why: '방문 표시 누락', fix_hint: '큐에 넣을 때 표시' }],
    correct_points: ['SECRET-RUBRIC-1a'],
    missed_points: ['SECRET-RUBRIC-1b'],
    improved_md: 'IMPROVED-CODE',
    ...over,
  }
}
