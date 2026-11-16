'use client'

import Link from 'next/link'
import type { ActionStatus } from './hooks'

/** 쓰는 중 표시. 점 셋이 번갈아 깜박인다 (움직임 줄이기 설정이면 멈춘다) */
export function Writing({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-blink rounded-full bg-muted" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
      {text}
    </p>
  )
}

/** 행동의 결과 한 줄. 상태마다 색과 문구가 다르다 */
export function StatusLine({ status, busyText, onRetry }: {
  status: ActionStatus
  busyText: string
  /** 연결 끊김이면 같은 요청을, 실패면 새 요청을 보낸다 */
  onRetry?: () => void
}) {
  if (status.busy) return <Writing text={busyText} />
  if (!status.state || status.state === 'ok') return null

  const tone = status.state === 'in-progress' ? 'text-warn' : 'text-stop'
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-relaxed ${tone}`} role="alert">
      <span>{status.message}</span>
      {status.state === 'expired' && (
        <Link href="/login" className="underline underline-offset-4">다시 로그인</Link>
      )}
      {onRetry && (status.state === 'network' || status.state === 'failed' || status.state === 'save-failed') && (
        <button type="button" onClick={onRetry} className="underline underline-offset-4">
          다시 시도
        </button>
      )}
    </p>
  )
}
