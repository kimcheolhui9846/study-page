'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const WARN_MS = 2 * 60 * 1000 // 앰버로 바뀌는 지점
const CRITICAL_MS = 30 * 1000 // 테라코타로 바뀌는 지점
const RESYNC_THROTTLE_MS = 60 * 1000

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

type Stage = 'normal' | 'warn' | 'critical' | 'expired'

function stageOf(remaining: number): Stage {
  if (remaining <= 0) return 'expired'
  if (remaining <= CRITICAL_MS) return 'critical'
  if (remaining <= WARN_MS) return 'warn'
  return 'normal'
}

const SKIN: Record<Stage, { bar: string; time: string; button: string }> = {
  normal: {
    bar: 'bg-surface border-rule',
    time: 'text-muted',
    button: 'border border-rule-strong text-body hover:bg-paper',
  },
  warn: {
    bar: 'bg-warn-tint border-warn-rule',
    time: 'text-warn',
    button: 'border border-warn-rule text-body hover:bg-warn-tint',
  },
  critical: {
    bar: 'bg-stop-tint border-stop-rule',
    time: 'text-stop',
    button: 'border border-stop-rule text-body hover:bg-stop-tint',
  },
  expired: {
    bar: 'bg-stop-tint border-stop-rule',
    time: 'text-stop',
    button: 'border border-stop-rule text-body hover:bg-stop-tint',
  },
}

export interface SessionBarProps {
  /** 왼쪽에 붙는 라벨. 학습 중이면 'CS · DAY 5', 대시보드면 'STUDY'. */
  label?: string
  /**
   * 만료가 임박했을 때 보여줄 한 줄.
   *
   * 화면마다 잃을 것이 다르다. 아무것도 안 쓴 대시보드에서 "쓰던 답은
   * 남는다"고 말하면 거짓말이 된다. 2주차의 학습 화면이 초안 보관을
   * 구현하면서 그 문장을 여기로 넘긴다.
   */
  expiringNote?: string
}

/**
 * 모든 화면 위에 얹히는 세션 바.
 *
 * ★ 카운트다운은 서버가 준 만료 시각을 기준으로 그린다. 클라이언트가 자체
 * 타이머를 굴리면 탭이 백그라운드로 가거나 노트북이 잠들 때 어긋난다.
 *
 * ★ `/api/session/status` 를 폴링하지 않는다. 가드가 통과할 때마다 유휴
 * 만료를 밀기 때문에, 주기적으로 부르면 넣지 않기로 한 하트비트가 뒷문으로
 * 들어온다. 다시 부르는 경우는 딱 하나 — 사용자가 실제로 뭔가 했을 때다.
 * 자리를 비우면 요청이 0건이고 세션은 예정대로 닫힌다.
 */
export function SessionBar({ label = 'STUDY', expiringNote }: SessionBarProps) {
  const router = useRouter()
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const lastSync = useRef(0)
  const syncing = useRef(false)

  const sync = useCallback(async () => {
    if (syncing.current) return
    syncing.current = true
    try {
      const res = await fetch('/api/session/status')
      if (!res.ok) { setDeadline(0); return }
      const body = await res.json()
      // 두 만료 중 먼저 오는 쪽이 실제 남은 시간이다.
      // 유휴는 활동마다 밀리고, 절대 만료는 밀리지 않는다.
      setDeadline(Math.min(
        new Date(body.idleExpiresAt).getTime(),
        new Date(body.expiresAt).getTime(),
      ))
      lastSync.current = Date.now()
    } catch {
      // 네트워크가 끊긴 것과 세션이 죽은 것을 구별할 수 없다.
      // 카운트다운을 멈춰두고 다음 활동에서 다시 물어본다.
    } finally {
      syncing.current = false
    }
  }, [])

  useEffect(() => { void sync() }, [sync])

  // 1초마다 다시 그리기만 한다. 서버에 묻지 않는다.
  useEffect(() => {
    if (deadline === null) return
    const tick = () => setRemaining(deadline - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  // 사용자가 실제로 움직였을 때만, 그것도 1분에 한 번만 다시 물어본다.
  // 서버는 이미 그 활동으로 유휴 만료를 밀었을 것이고, 여기서는 밀린 값을
  // 받아 화면을 맞춘다. 타이머가 아니라 사람이 방아쇠라서 하트비트가 아니다.
  useEffect(() => {
    const onActivity = () => {
      if (Date.now() - lastSync.current < RESYNC_THROTTLE_MS) return
      void sync()
    }
    const events = ['keydown', 'pointerdown'] as const
    for (const e of events) window.addEventListener(e, onActivity)
    return () => { for (const e of events) window.removeEventListener(e, onActivity) }
  }, [sync])

  // 탭이 닫힐 때 최선 노력으로 세션을 끊는다.
  // 보장되지 않는다 — 확실한 안전망은 서버의 유휴 15분 타임아웃이다.
  useEffect(() => {
    const onHide = () => { navigator.sendBeacon('/api/session/end') }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  async function end() {
    await fetch('/api/session/end', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  // 만료되면 스스로 나간다. 죽은 세션으로 화면을 붙잡고 있을 이유가 없다.
  useEffect(() => {
    if (deadline === null || remaining > 0) return
    router.replace('/login')
    router.refresh()
  }, [deadline, remaining, router])

  // 아직 서버 답을 못 받았으면 자리만 잡아둔다. 높이가 흔들리지 않게.
  if (deadline === null) {
    return <div className="h-[52px] border-b border-rule bg-surface" />
  }

  const stage = stageOf(remaining)
  const skin = SKIN[stage]

  return (
    <div
      className={`flex h-[52px] shrink-0 items-center justify-between gap-6 border-b px-8 ${skin.bar}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {stage === 'normal' ? (
          <>
            <span className="size-[7px] shrink-0 rounded-full bg-ok" />
            <span className="font-mono text-xs tracking-[0.1em] text-body">{label}</span>
          </>
        ) : (
          <>
            <span
              className={`size-[7px] shrink-0 rounded-full ${stage === 'warn' ? 'bg-warn' : 'bg-stop'}`}
            />
            <span className="truncate text-[13px] text-muted">
              {stage === 'expired'
                ? '세션이 닫혔다. 로그인 화면으로 돌아간다.'
                : stage === 'warn'
                  ? '2분 뒤 세션이 닫힌다. 아무 키나 누르면 15분으로 되돌아간다.'
                  : (expiringNote ?? '곧 세션이 닫힌다. 계속하려면 오른쪽 버튼을 누른다.')}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-[18px]">
        <span className={`font-mono text-[12.5px] ${skin.time}`}>
          남은 시간 <span className="text-ink">{format(remaining)}</span>
        </span>

        {stage === 'critical' ? (
          <button
            onClick={() => void sync()}
            className="h-[30px] cursor-pointer rounded-control bg-ink px-3.5 text-[12.5px] text-paper"
          >
            계속하기
          </button>
        ) : (
          <button
            onClick={end}
            className={`h-[30px] cursor-pointer rounded-control px-3.5 text-[12.5px] ${skin.button}`}
          >
            종료
          </button>
        )}
      </div>
    </div>
  )
}
