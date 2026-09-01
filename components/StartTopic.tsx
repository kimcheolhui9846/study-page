'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface StartTopicProps {
  topicId: string
  kind: 'new' | 'review' | 'remediation'
  round: number | null
  callsLeft: number
}

/**
 * 「자료 만들기」가 곧 돈을 쓰는 버튼이다.
 *
 * 그 사실을 숨기지 않는다 — 버튼 옆에 오늘 남은 호출 수를 적고, 한 번
 * 만들면 그 Topic 의 자료는 앞으로도 이것 하나라는 것도 말한다.
 * 0 이면 눌리지 않는다. (화면이 막는 게 아니라 서버가 막지만,
 * 누르고 나서 알 이유가 없다)
 */
const COPY: Record<StartTopicProps['kind'], string> = {
  new: '만들면 지문과 문제 3개가 나온다.',
  review: '만들면 짧은 되짚기와 문제 2개가 나온다.',
  remediation: '만들면 이 개념을 처음부터 다루는 지문과 문제 3개가 나온다.',
}

const MESSAGES: Record<string, string> = {
  BUDGET_EXCEEDED: '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.',
  NOT_IN_TODAYS_PLAN: '오늘 계획에 없는 주제다.',
  STORED_INVALID: '저장된 자료를 읽을 수 없다. 이건 사람이 볼 일이다.',
}

export function StartTopic({ topicId, kind, round, callsLeft }: StartTopicProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)

    const res = await fetch('/api/topic/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topicId }),
    })

    if (res.ok) { router.refresh(); return }

    const body = await res.json().catch(() => ({}))
    setError(MESSAGES[body.error] ?? '자료를 만들지 못했다. 잠시 뒤 다시 시도해라.')
    setBusy(false)
  }

  return (
    <div className="mt-12 flex flex-col items-center rounded-card bg-surface px-9 py-11 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <p className="max-w-[380px] text-balance text-[14.5px] leading-[1.85] text-body">
        {COPY[kind]}
      </p>
      <p className="mt-3 max-w-[380px] text-balance text-[12.5px] leading-[1.85] text-faint">
        {round === null
          ? '이 주제의 자료는 앞으로도 이것 하나다. 다시 만들지 않는다.'
          : `${round}회차 복습 자료는 이것 하나다. 다시 만들지 않는다.`}
      </p>

      {error && <p className="mt-6 text-[12.5px] leading-relaxed text-stop">{error}</p>}

      <button
        onClick={start}
        disabled={busy || callsLeft <= 0}
        className="mt-8 h-12 w-full max-w-[260px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
      >
        {busy ? '만드는 중…' : '자료 만들기'}
      </button>

      <span className="mt-4 font-mono text-[10.5px] tracking-[0.22em] text-faint">
        AI 호출 1회 · 오늘 남은 {callsLeft}
      </span>
    </div>
  )
}
