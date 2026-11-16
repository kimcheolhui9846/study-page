'use client'

import { useEffect, useRef } from 'react'
import type { PublicMessage } from '@/lib/study/store'
import type { StudyMode } from '@/lib/study/modes'
import { Md } from './Md'
import { MODE_STYLE } from './modeStyle'
import { StatusLine } from './StatusLine'
import { useDraft, useStudyAction } from './hooks'

const KIND_TAG: Record<string, string> = {
  material: '자료', feedback: '피드백', notice: '안내',
}

export function ChatPanel({ sessionId, messages, focus, onClearFocus, modeId }: {
  sessionId: number
  messages: PublicMessage[]
  focus: { id: number; number: number } | null
  onClearFocus: () => void
  modeId: StudyMode
}) {
  const st = MODE_STYLE[modeId]
  const [text, setText, clearText] = useDraft(`chat:${sessionId}`)
  const chat = useStudyAction()
  const more = useStudyAction()
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  async function send() {
    const r = await chat.run(`/api/study/sessions/${sessionId}/messages`, {
      text, problemId: focus?.id,
    })
    // 실패하면 입력을 지우지 않는다. 서버에 남은 메시지는 새로고침으로 보인다.
    if (r.state === 'ok') clearText()
  }

  function askMore(instruction: string) {
    return more.run(`/api/study/sessions/${sessionId}/more`, { instruction })
  }

  const busy = chat.status.busy || more.status.busy

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <header className="flex items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <span className={`h-2 w-2 rounded-full ${st.bg}`} />
        <span className="font-mono text-[10px] tracking-[0.24em] text-faint">대화</span>
      </header>
      <ol className="flex min-h-[260px] grow flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-5 lg:max-h-[calc(100vh-300px)]">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`animate-rise ${m.role === 'user'
              ? `ml-10 self-end rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-paper ${st.bg}`
              : m.kind === 'notice'
                ? 'flex items-center gap-3 self-stretch text-[11.5px] text-faint before:h-px before:grow before:bg-rule-soft after:h-px after:grow after:bg-rule-soft'
                : `mr-3 border-l-2 pl-3.5 ${m.kind === 'chat' ? 'border-rule-strong' : st.border}`}`}
          >
            {m.role === 'user' ? m.bodyMd : m.kind === 'notice' ? (
              <span className="shrink-0">{m.bodyMd}</span>
            ) : (
              <>
                {KIND_TAG[m.kind] && (
                  <span className={`font-mono text-[10px] tracking-[0.2em] ${st.text}`}>{KIND_TAG[m.kind]}</span>
                )}
                <Md className="text-[14.5px]">{m.bodyMd}</Md>
              </>
            )}
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      <div className="border-t border-rule-soft bg-paper/60 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => askMore('같은 주제로 새 문제를 낸다')}
            className="rounded-full bg-surface px-3 py-1.5 text-[12px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:text-ink disabled:opacity-40">
            추가 문제
          </button>
          <button type="button" disabled={busy} onClick={() => askMore('같은 주제를 더 쉽게, 기초부터 다시 설명하고 쉬운 문제를 낸다')}
            className="rounded-full bg-surface px-3 py-1.5 text-[12px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:text-ink disabled:opacity-40">
            더 쉽게
          </button>
          <button type="button" disabled={busy} onClick={() => askMore('설명은 줄이고 연습문제 위주로 낸다')}
            className="rounded-full bg-surface px-3 py-1.5 text-[12px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:text-ink disabled:opacity-40">
            문제 위주로
          </button>
        </div>

        {focus && (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <span className={`rounded-full px-2.5 py-0.5 font-mono ${st.tint} ${st.text}`}>{focus.number}번 문제</span>
            에 대해 묻는다
            <button type="button" onClick={onClearFocus} className="text-faint underline underline-offset-4">해제</button>
          </p>
        )}

        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !busy) send()
            }}
            rows={2}
            maxLength={4000}
            placeholder="질문하거나, 「2번 문제 다시 설명해 줘」처럼 말한다"
            aria-label="메시지"
            className="min-w-0 grow resize-y rounded-control bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed text-body shadow-[inset_0_0_0_1px_var(--color-rule)] outline-none placeholder:text-ghost focus:shadow-[inset_0_0_0_1px_var(--color-rule-strong)]"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || text.trim().length === 0}
            className={`h-10 shrink-0 rounded-control px-4 text-[13px] text-paper transition-all hover:brightness-110 disabled:opacity-35 ${st.bg}`}
          >
            보내기
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-1">
          <StatusLine status={chat.status} busyText="답을 쓰는 중이다…" onRetry={send} />
          <StatusLine status={more.status} busyText="새 자료를 만드는 중이다…" />
        </div>
      </div>
    </section>
  )
}
