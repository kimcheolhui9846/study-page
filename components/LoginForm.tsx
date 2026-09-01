'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Failure = { kind: 'wrong' } | { kind: 'locked' }

export function LoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setFailure(null)

    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.replace('/')
      router.refresh()
      return
    }

    // 잠금과 오답은 둘 다 실패지만 사용자가 할 일이 다르다.
    // 잠긴 동안에는 맞는 비밀번호도 받지 않으므로 그렇게 말해야 한다.
    const body = await res.json().catch(() => ({}))
    setFailure(body.error === 'LOCKED_OUT' ? { kind: 'locked' } : { kind: 'wrong' })
    setPassword('')
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="contents">
      <div className="mt-12 flex flex-col gap-2.5">
        <label
          htmlFor="password"
          className="font-mono text-[11.5px] tracking-[0.12em] text-muted"
        >
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={failure?.kind === 'locked'}
          autoFocus
          className="h-[50px] border-b-[1.5px] border-ink bg-transparent px-0.5 text-xl tracking-[0.18em] text-ink outline-none disabled:border-rule-strong disabled:text-ghost"
        />
      </div>

      <button
        type="submit"
        disabled={busy || password.length === 0 || failure?.kind === 'locked'}
        className="mt-7 h-[50px] cursor-pointer rounded-control bg-ink text-[15px] font-medium tracking-[0.02em] text-paper disabled:cursor-not-allowed disabled:opacity-35"
      >
        {busy ? '확인 중…' : '들어가기'}
      </button>

      {failure?.kind === 'wrong' && (
        <p className="mt-4 text-[13px] leading-relaxed text-stop">비밀번호가 틀렸다.</p>
      )}

      {failure?.kind === 'locked' && (
        <div className="mt-4 flex flex-col gap-1.5 rounded-control bg-stop-tint px-4 py-3.5">
          <span className="font-mono text-[11px] tracking-[0.1em] text-stop">잠시 잠갔다</span>
          <p className="text-[13px] leading-[1.75] text-body">
            15분 안에 비밀번호를 5번 틀렸다. 다음 15분 동안은 맞는 비밀번호도 받지 않는다.
          </p>
        </div>
      )}
    </form>
  )
}
