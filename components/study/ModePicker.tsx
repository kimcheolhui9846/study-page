'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StudyMode } from '@/lib/study/modes'
import { MODE_STYLE } from './modeStyle'
import { StatusLine } from './StatusLine'
import { useDraft, useStudyAction } from './hooks'

/** 화면에 보여도 되는 모드 정보만. 하네스 규칙 문장은 넘기지 않는다 */
export interface ModeCard {
  id: StudyMode
  label: string
  blurb: string
  examples: string[]
}

/**
 * 홈의 시작 칸. 모드를 고르고 공부하고 싶은 것을 쓰면 바로 시작한다.
 * 기간·비중·선수 과목 설정을 먼저 요구하지 않는다.
 */
export function ModePicker({ modes }: { modes: ModeCard[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<StudyMode>(modes[0].id)
  const [request, setRequest, clearRequest] = useDraft('start')
  const { run, status } = useStudyAction()
  const current = modes.find((m) => m.id === mode)!
  const st = MODE_STYLE[mode]

  async function start() {
    const r = await run('/api/study/sessions', { mode, request })
    if (r.state === 'ok') {
      const id = (r.data as { sessionId: number }).sessionId
      clearRequest()
      router.push(`/study/${id}`)
    }
  }

  return (
    <section className="mt-12">
      <div role="tablist" aria-label="과목" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {modes.map((m, i) => {
          const s = MODE_STYLE[m.id]
          const on = m.id === mode
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setMode(m.id)}
              style={{ animationDelay: `${i * 60}ms` }}
              className={`group relative flex h-[156px] animate-rise flex-col overflow-hidden rounded-card px-4 pt-4 pb-3.5 text-left transition-all duration-200 ${
                on
                  ? `${s.tint} ${s.ring} -translate-y-0.5`
                  : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-rule)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_var(--color-rule-strong)]'
              }`}
            >
              {/* 과목 글자. 카드 오른쪽 위 — 설명 글과 겹치지 않게 */}
              <span
                aria-hidden
                className={`pointer-events-none absolute top-2 right-3 font-serif text-[46px] leading-none tracking-[-0.05em] transition-opacity duration-200 ${s.text} ${on ? 'opacity-60' : 'opacity-[0.14] group-hover:opacity-30'}`}
              >
                {s.glyph}
              </span>
              <span className={`font-mono text-[10px] tracking-[0.24em] ${on ? s.text : 'text-faint'}`}>
                0{i + 1}
              </span>
              <span className="mt-1.5 font-serif text-[24px] leading-tight tracking-[-0.02em] text-ink">{m.label}</span>
              <span className="relative mt-auto text-[11.5px] leading-[1.55] text-muted">{m.blurb}</span>
            </button>
          )
        })}
      </div>

      <div className={`mt-6 rounded-card bg-surface px-5 pt-6 pb-6 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-8 sm:pt-7`}>
        <label htmlFor="study-request" className="flex items-baseline gap-3">
          <span className={`font-serif text-[20px] ${st.text}`}>{st.glyph}</span>
          <span className="font-serif text-[19px] text-ink">{current.label}</span>
          <span className="text-[13px] text-muted">— 지금 무엇을 공부하고 싶은가</span>
        </label>

        <textarea
          id="study-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={current.examples[0]}
          className={`ruled mt-3 w-full resize-y border-l-2 bg-transparent pl-4 text-[16px] text-ink outline-none placeholder:text-ghost ${st.border}`}
        />

        <p className="mt-5 font-mono text-[10px] tracking-[0.22em] text-faint">이렇게 시작해도 된다</p>
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {current.examples.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => setRequest(ex)}
                className="rounded-full bg-chip px-3.5 py-1.5 text-left text-[12.5px] leading-snug text-muted transition-colors hover:bg-rule hover:text-ink"
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <StatusLine status={status} busyText="요청을 읽고 자료를 쓰는 중이다 — 30초 안팎" onRetry={start} />
          <span className="hidden grow sm:block" />
          <button
            type="button"
            onClick={start}
            disabled={status.busy || request.trim().length === 0}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-control px-7 text-[14px] font-medium tracking-[0.04em] text-paper transition-all hover:brightness-110 disabled:opacity-35 sm:w-auto ${st.bg}`}
          >
            {status.busy ? '쓰는 중…' : '학습 시작'}
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </section>
  )
}
