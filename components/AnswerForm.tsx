'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearDraft, loadDraft, saveDraft, type Answers } from '@/lib/study/draft'

export interface Question {
  id: string
  type: string
  prompt: string
}

export interface AnswerFormProps {
  subject: string
  dayNo: number
  questions: Question[]
  attemptsLeft: number
}

const TYPE_LABEL: Record<string, string> = {
  recall: '기억', concept: '개념', application: '적용',
}

export function AnswerForm({ subject, dayNo, questions, attemptsLeft }: AnswerFormProps) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Answers>({})
  const [hints, setHints] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 초안은 마운트 후에 읽는다. 서버 렌더에는 localStorage 가 없다.
  useEffect(() => { setAnswers(loadDraft(subject, dayNo)) }, [subject, dayNo])

  function update(id: string, value: string) {
    const next = { ...answers, [id]: value }
    setAnswers(next)
    saveDraft(subject, dayNo, next)
  }

  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0)

  async function submit() {
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/study/${subject}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayNo, answers }),
    })

    if (res.ok) {
      // 채점까지 갔으면 초안의 역할이 끝났다. attempts 행이 원본이다.
      clearDraft(subject, dayNo)
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'CAP_EXCEEDED' ? '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.'
      : body.error === 'ATTEMPT_CAP' ? '채점은 하루 2회까지다.'
      : '채점에 실패했다. 답은 그대로 남아 있으니 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-16 flex flex-col">
      <h2 className="text-center font-serif text-[28px] tracking-[-0.02em] text-ink">문제</h2>
      <p className="mt-3 text-center font-mono text-[10.5px] tracking-[0.22em] text-faint">
        서술형 3문항
      </p>

      <div className="mt-10 flex flex-col gap-10">
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
                {String(i + 1).padStart(2, '0')} · {TYPE_LABEL[q.type] ?? q.type}
              </span>
              {/* 문제는 짧으므로 가운데 정렬이 읽기를 해치지 않는다.
                  답안(아래 textarea)은 길어지므로 왼쪽에 둔다. */}
              <p className="text-balance font-serif text-[20px] leading-relaxed text-ink">
                {q.prompt}
              </p>
            </div>

            <textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => update(q.id, e.target.value)}
              rows={5}
              placeholder="여기에 답을 쓴다."
              className="mt-5 rounded-card bg-surface px-5 py-4 text-[15.5px] leading-[1.85] text-body shadow-[inset_0_0_0_1px_var(--color-rule)] outline-none transition-shadow placeholder:text-ghost focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
            />

            <div className="mt-2.5 flex items-center justify-between">
              {hints[q.id] ? (
                <span className="text-pretty text-[12.5px] leading-[1.7] text-muted">
                  힌트 — {hints[q.id]}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void showHint(q.id)}
                  className="cursor-pointer text-[12.5px] text-muted underline underline-offset-4 hover:text-body"
                >
                  힌트 보기
                </button>
              )}
              <span className="shrink-0 pl-4 font-mono text-[11px] text-ghost">
                {(answers[q.id] ?? '').length}자
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-14 h-px w-16 bg-rule" />

      {error && (
        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-stop">{error}</p>
      )}

      <div className="mt-6 flex flex-col items-center gap-4">
        <button
          onClick={submit}
          disabled={busy || !allAnswered || attemptsLeft === 0}
          className="h-12 w-full max-w-[280px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
        >
          {busy ? '채점 중…' : '제출하고 채점받기'}
        </button>
        <span className="text-[12px] text-faint">
          채점은 하루 2회까지. 남은 횟수{' '}
          <span className="font-mono text-muted">{attemptsLeft}</span>
        </span>
      </div>
    </div>
  )

  /** 힌트는 DB 에 이미 있다. LLM 을 부르지 않으므로 비용이 0원이다. */
  async function showHint(id: string) {
    if (hints[id]) return
    const res = await fetch(`/api/study/${subject}/hint?dayNo=${dayNo}&questionId=${id}`)
    if (!res.ok) return
    const body = await res.json()
    setHints((h) => ({ ...h, [id]: body.hint }))
  }
}
