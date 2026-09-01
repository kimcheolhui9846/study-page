'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface StartDayProps {
  subject: string
  dayNo: number
  callsLeft: number
}

/**
 * 「오늘 시작하기」가 곧 돈을 쓰는 버튼이다.
 *
 * 그 사실을 숨기지 않는다 — 버튼 옆에 오늘 남은 호출 수를 적고,
 * 한 번 만들면 되돌릴 수 없다는 것도 말한다. 0 이면 눌리지 않는다.
 * (화면이 막는 게 아니라 서버가 막지만, 누르고 나서 알 이유가 없다)
 */
export function StartDay({ subject, dayNo, callsLeft }: StartDayProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/study/${subject}/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayNo }),
    })

    if (res.ok) {
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'CAP_EXCEEDED'
        ? '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.'
        : body.error === 'ALREADY_STUDIED_TODAY'
          ? '이 과목은 오늘 이미 했다. 내일 이어서 한다.'
          : '지문을 만들지 못했다. 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-12 flex flex-col items-center rounded-card bg-surface px-9 py-11 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <p className="max-w-[380px] text-balance text-[14.5px] leading-[1.85] text-body">
        시작하면 오늘치 지문과 문제 3개가 만들어진다.
      </p>
      <p className="mt-3 max-w-[380px] text-balance text-[12.5px] leading-[1.85] text-faint">
        한 번 만들면 오늘은 다시 만들 수 없고, 이 Day 의 내용은 앞으로도 이것 하나다.
      </p>

      {error && <p className="mt-6 text-[12.5px] leading-relaxed text-stop">{error}</p>}

      <button
        onClick={start}
        disabled={busy || callsLeft <= 0}
        className="mt-8 h-12 w-full max-w-[260px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
      >
        {busy ? '만드는 중…' : '오늘 시작하기'}
      </button>

      <span className="mt-4 font-mono text-[10.5px] tracking-[0.22em] text-faint">
        오늘 남은 AI 호출 {callsLeft}
      </span>
    </div>
  )
}
