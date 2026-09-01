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
  topicId: string
  questions: Question[]
  /** 이미 저장된 답. 다시 열었을 때 그대로 보여야 한다 */
  saved: Answers | null
}

const TYPE_LABEL: Record<string, string> = {
  recall: '기억', concept: '개념', application: '적용',
}

/**
 * 답안을 저장한다. **채점하지 않는다.**
 *
 * 채점은 하루의 모든 항목을 모아 한 번에 부르므로(호출 1회), 여기서
 * 저장만 하고 「오늘의 학습」으로 돌아간다. 이 버튼은 돈을 쓰지 않는다.
 */
export function AnswerForm({ topicId, questions, saved }: AnswerFormProps) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Answers>(saved ?? {})
  const [hints, setHints] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 초안은 마운트 후에 읽는다. 서버 렌더에는 localStorage 가 없다.
  // 서버에 저장된 답이 있으면 그쪽이 원본이므로 초안을 덮어쓰지 않는다.
  useEffect(() => {
    if (saved) return
    const draft = loadDraft(topicId)
    if (Object.keys(draft).length > 0) setAnswers(draft)
  }, [topicId, saved])

  function update(id: string, value: string) {
    const next = { ...answers, [id]: value }
    setAnswers(next)
    saveDraft(topicId, next)
  }

  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0)

  async function submit() {
    setBusy(true)
    setError(null)

    const res = await fetch('/api/topic/answers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topicId, answers }),
    })

    if (res.ok) {
      // 서버에 남았으면 초안의 역할이 끝났다. plan_items.answers 가 원본이다.
      clearDraft(topicId)
      router.push('/today')
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'ALREADY_GRADED'
        ? '이 주제는 이미 채점이 끝났다. 「오늘의 학습」에서 결과를 볼 수 있다.'
        : '저장하지 못했다. 답은 브라우저에 남아 있으니 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-16 flex flex-col">
      <h2 className="text-center font-serif text-[28px] tracking-[-0.02em] text-ink">문제</h2>
      <p className="mt-3 text-center font-mono text-[10.5px] tracking-[0.22em] text-faint">
        서술형 {questions.length}문항
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
          disabled={busy || !allAnswered}
          className="h-12 w-full max-w-[280px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
        >
          {busy ? '저장 중…' : saved ? '답 고치기' : '답 저장하기'}
        </button>
        <p className="max-w-[380px] text-balance text-center text-[12px] leading-[1.8] text-faint">
          저장은 AI 를 부르지 않는다. 채점은 오늘 것을 다 쓴 뒤 한 번에 받는다.
        </p>
      </div>
    </div>
  )

  /** 힌트는 DB 에 이미 있다. LLM 을 부르지 않으므로 비용이 0원이다. */
  async function showHint(id: string) {
    if (hints[id]) return
    const res = await fetch(
      `/api/topic/hint?topicId=${encodeURIComponent(topicId)}&questionId=${encodeURIComponent(id)}`,
    )
    if (!res.ok) return
    const body = await res.json()
    setHints((h) => ({ ...h, [id]: body.hint }))
  }
}
