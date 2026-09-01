'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ScoreEntryProps {
  topicId: string
  planId: number
  disabled?: boolean
}

/**
 * 2단계의 점수 입력.
 *
 * 3단계에서 GPT 채점이 붙으면 이 자리가 답안 작성으로 바뀐다. 그때까지는
 * 손으로 넣은 점수가 같은 경로(applyManualScore → applyResult)를 타므로,
 * 상태 전이와 복습 예약은 실제와 완전히 같다.
 */
const CHOICES = [
  { score: 95, label: '거의 다 안다', className: 'text-ok' },
  { score: 80, label: '대체로 안다', className: 'text-ok' },
  { score: 65, label: '반쯤 안다', className: 'text-warn' },
  { score: 45, label: '잘 모르겠다', className: 'text-stop' },
  { score: 20, label: '전혀 모르겠다', className: 'text-stop' },
]

export function ScoreEntry({ topicId, planId, disabled }: ScoreEntryProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(score: number) {
    setBusy(score)
    setError(null)

    const res = await fetch('/api/plan/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, topicId, score }),
    })

    if (res.ok) { router.refresh(); return }
    setError('저장하지 못했다. 잠시 뒤 다시 시도해라.')
    setBusy(null)
  }

  if (disabled) return null

  return (
    <div className="mt-5 flex flex-col items-center gap-3">
      <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
        오늘 이만큼 이해했다
      </span>

      <div className="flex flex-wrap justify-center gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.score}
            onClick={() => submit(c.score)}
            disabled={busy !== null}
            className={`h-9 cursor-pointer rounded-control px-3.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:bg-paper disabled:opacity-30 ${c.className}`}
          >
            {busy === c.score ? '저장 중…' : c.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[12.5px] text-stop">{error}</p>}
    </div>
  )
}
