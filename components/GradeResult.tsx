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

  // 점수는 모델이 준 값을 그대로 쓰지 않는다. 포인트 수를 세면
  // 화면과 루브릭이 항상 일치한다.
  const total = feedback.per_question.reduce(
    (n, q) => n + q.correct_points.length + q.missed_points.length, 0)
  const got = feedback.per_question.reduce((n, q) => n + q.correct_points.length, 0)

  return (
    <div className="mt-16 flex flex-col">
      <div className="text-center">
        <div className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
          {attemptNo}회차 채점
        </div>
        <h2 className="mt-5 font-serif text-[40px] leading-none tracking-[-0.03em] text-ink">
          {got}
          <span className="ml-2 font-mono text-[15px] tracking-normal text-faint">/ {total}</span>
        </h2>
        <p className={`mt-4 text-[13px] ${feedback.overall.goal_reached ? 'text-ok' : 'text-warn'}`}>
          {feedback.overall.goal_reached ? '오늘의 목표에 닿았다' : '목표까지 조금 남았다'}
        </p>
      </div>

      <div className="mt-12 flex flex-col gap-7">
        {feedback.per_question.map((q) => {
          const question = questions.find((x) => x.id === q.id)
          const points = q.correct_points.length + q.missed_points.length

          return (
            <div
              key={q.id}
              className="flex flex-col rounded-card bg-surface px-7 pt-7 pb-6 shadow-[inset_0_0_0_1px_var(--color-rule)]"
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

              <p className="mt-4 text-balance text-center font-serif text-[19px] leading-relaxed text-ink">
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

      {/* 3주차의 정리본 화면이 이 목록을 체크리스트로 쓴다. 지금은 미리 보여만 준다. */}
      {feedback.summary_seed.length > 0 && (
        <div className="mt-8 flex flex-col gap-3 rounded-card bg-note px-7 py-6">
          <span className="font-mono text-[10.5px] tracking-[0.18em] text-muted">
            정리본에 담을 것
          </span>
          {feedback.summary_seed.map((s) => (
            <span key={s} className="text-pretty text-[13.5px] leading-[1.75] text-body">
              · {s}
            </span>
          ))}
        </div>
      )}

      <div className="mx-auto mt-14 h-px w-16 bg-rule" />

      <div className="mt-6 flex flex-col items-center gap-4">
        <button
          onClick={() => finish(false)}
          disabled={busy}
          className="h-12 w-full max-w-[280px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          오늘 마치기
        </button>

        <span className="text-[12px] text-faint">
          재채점 남은 횟수 <span className="font-mono text-muted">{attemptsLeft}</span>
        </span>

        <button
          onClick={() => finish(true)}
          disabled={busy}
          className="mt-2 cursor-pointer text-[12.5px] text-muted underline underline-offset-4 hover:text-body disabled:opacity-40"
        >
          이 채점이 틀렸다
        </button>

        <p className="max-w-[380px] text-balance text-center text-[11.5px] leading-[1.8] text-faint">
          「이 채점이 틀렸다」는 AI 를 다시 부르지 않는다. 기록만 남기고 오늘을 마친다.
        </p>
      </div>
    </div>
  )
}
