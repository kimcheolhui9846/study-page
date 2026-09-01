'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface GradePlanProps {
  /** 답을 다 쓴 항목 수. 이만큼이 한 번의 호출로 채점된다 */
  ready: number
  callsLeft: number
}

const MESSAGES: Record<string, string> = {
  BUDGET_EXCEEDED: '오늘 쓸 수 있는 AI 호출을 다 썼다. 자정에 초기화된다.',
  NO_ANSWERS: '채점할 답안이 없다.',
  MATERIAL_MISSING: '자료를 읽을 수 없는 항목이 있다. 채점하지 않았다.',
}

/**
 * 하루치를 한 번에 채점한다.
 *
 * ★ 항목마다 채점 버튼을 두지 않는 것이 설계다. 그러면 하루 호출 수가
 * (생성 N + 채점 N)이 된다. 여기서 한 번에 부르면 (생성 N + 1)이고,
 * 그 숫자가 계획이 미리 예고한 값과 같다.
 */
export function GradePlan({ ready, callsLeft }: GradePlanProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function grade() {
    setBusy(true)
    setError(null)

    const res = await fetch('/api/plan/grade', { method: 'POST' })

    if (res.ok) { router.refresh(); return }

    const body = await res.json().catch(() => ({}))
    setError(MESSAGES[body.error] ?? '채점하지 못했다. 답은 그대로 남아 있다.')
    setBusy(false)
  }

  return (
    <div className="mt-12 flex flex-col items-center rounded-card bg-surface px-9 py-10 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <p className="max-w-[400px] text-balance text-[14.5px] leading-[1.85] text-body">
        {ready}개를 한 번에 채점한다.
      </p>
      <p className="mt-3 max-w-[400px] text-balance text-[12.5px] leading-[1.85] text-faint">
        항목마다 부르지 않는다. 하루의 채점은 AI 호출 1회다.
      </p>

      {error && <p className="mt-6 text-[12.5px] leading-relaxed text-stop">{error}</p>}

      <button
        onClick={grade}
        disabled={busy || callsLeft <= 0}
        className="mt-8 h-12 w-full max-w-[280px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
      >
        {busy ? '채점 중…' : '오늘 것 채점받기'}
      </button>

      <span className="mt-4 font-mono text-[10.5px] tracking-[0.22em] text-faint">
        AI 호출 1회 · 오늘 남은 {callsLeft}
      </span>
    </div>
  )
}
