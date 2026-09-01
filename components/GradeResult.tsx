import type { GradedTopic } from '@/lib/llm/schemas'

export interface GradeResultProps {
  /** 화면에 문제 문구를 다시 보여주기 위한 것. 루브릭은 들어 있지 않다 */
  questions: Array<{ id: string; prompt: string }>
  answers: Record<string, string>
  feedback: GradedTopic
  /** 이 Topic 의 숙련도. lib/mastery/score.ts 가 만든 값이다 */
  masteryScore: number
  nextReviewAt: string | null
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

/**
 * 채점 결과.
 *
 * ★ 큰 숫자는 맞은 포인트 수다. 백분율이 아니다.
 * 모델이 준 점수를 쓰지 않는 것과 같은 이유로, 화면도 자기가 셀 수 있는
 * 것만 크게 보여준다 — 그래야 루브릭과 화면이 어긋날 수 없다.
 * 숙련도(0~100)는 여러 날에 걸쳐 섞인 값이라 따로, 작게 적는다.
 */
export function GradeResult(props: GradeResultProps) {
  const { questions, answers, feedback, masteryScore, nextReviewAt } = props

  const total = feedback.questions.reduce(
    (n, q) => n + q.correct_points.length + q.missed_points.length, 0)
  const got = feedback.questions.reduce((n, q) => n + q.correct_points.length, 0)

  return (
    <div className="mt-14 flex flex-col">
      <div className="text-center">
        <div className="font-mono text-[10.5px] tracking-[0.22em] text-faint">채점 결과</div>

        <h2 className="mt-5 font-serif text-[40px] leading-none tracking-[-0.03em] text-ink">
          {got}
          <span className="ml-2 font-mono text-[15px] tracking-normal text-faint">/ {total}</span>
        </h2>

        <p className="mt-4 font-mono text-[11px] tracking-[0.18em] text-muted">
          숙련도 {masteryScore}
          {nextReviewAt && <span className="text-faint"> · 복습 {nextReviewAt}</span>}
        </p>
      </div>

      <div className="mt-12 flex flex-col gap-7">
        {feedback.questions.map((q) => {
          const question = questions.find((x) => x.id === q.id)
          const points = q.correct_points.length + q.missed_points.length

          return (
            <div
              key={q.id}
              className="flex flex-col rounded-card bg-surface px-5 pt-6 pb-5 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-7 sm:pt-7 sm:pb-6"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
                  {q.id.toUpperCase()}
                </span>
                <span
                  className={`font-mono text-[11.5px] ${q.missed_points.length === 0 ? 'text-ok' : 'text-warn'}`}
                >
                  {q.correct_points.length} / {points}
                </span>
              </div>

              <p className="mt-4 text-balance text-center font-serif text-[17px] leading-relaxed text-ink sm:text-[19px]">
                {question?.prompt}
              </p>

              {/* 내가 쓴 답. 길 수 있으므로 왼쪽 정렬이다. */}
              <p className="mt-6 border-l-2 border-rule-soft pl-4 text-pretty text-[14px] leading-[1.85] text-muted">
                {answers[q.id]?.trim() || '(답을 쓰지 않음)'}
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {q.correct_points.map((p) => (
                  <div key={p} className="flex gap-3">
                    <Check />
                    <span className="text-pretty text-[14px] leading-[1.75] text-body">{p}</span>
                  </div>
                ))}
                {q.missed_points.map((p) => (
                  <div key={p} className="flex gap-3">
                    <Dash />
                    <span className="text-pretty text-[14px] leading-[1.75] text-body">
                      <span className="text-warn">놓침 — </span>
                      {p}
                    </span>
                  </div>
                ))}
              </div>

              {q.misconceptions.length > 0 && (
                <div className="mt-6 flex flex-col gap-2 rounded-control bg-stop-tint px-4 py-3.5">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] text-stop">
                    바로잡을 것
                  </span>
                  {q.misconceptions.map((m) => (
                    <span key={m} className="text-pretty text-[14px] leading-[1.75] text-body">
                      {m}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-6 text-pretty text-[13.5px] leading-[1.8] text-muted">
                {q.feedback_ko}
              </p>
            </div>
          )
        })}
      </div>

      {feedback.summarySeed.length > 0 && (
        <div className="mt-8 flex flex-col gap-3 rounded-card bg-note px-5 py-5 sm:px-7 sm:py-6">
          <span className="font-mono text-[10.5px] tracking-[0.18em] text-muted">
            정리본에 담을 것
          </span>
          {feedback.summarySeed.map((s) => (
            <span key={s} className="text-pretty text-[13.5px] leading-[1.75] text-body">
              · {s}
            </span>
          ))}
        </div>
      )}

      {feedback.missingPrerequisites.length > 0 && (
        <div className="mt-5 flex flex-col gap-2 rounded-card bg-note px-5 py-5 sm:px-7 sm:py-6">
          <span className="font-mono text-[10.5px] tracking-[0.18em] text-warn">
            먼저 봐야 할지도 모르는 것
          </span>
          {feedback.missingPrerequisites.map((s) => (
            <span key={s} className="text-pretty text-[13.5px] leading-[1.75] text-body">
              · {s}
            </span>
          ))}
          <span className="mt-2 text-pretty text-[11.5px] leading-[1.7] text-faint">
            채점자의 짐작이다. 실제로 무엇을 보충할지는 커리큘럼의 선수 관계가 정한다.
          </span>
        </div>
      )}
    </div>
  )
}
