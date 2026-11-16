'use client'

import { useState } from 'react'
import type { SessionView } from '@/lib/study/store'
import type { FeedbackMode, StudyMode } from '@/lib/study/modes'
import { ChatPanel } from './ChatPanel'
import { Md } from './Md'
import { MODE_STYLE } from './modeStyle'
import { ProblemCard } from './ProblemCard'

const BLOCK_LABEL: Record<string, string> = {
  explain: '설명', example: '예제', code: '코드', table: '표', passage: '지문',
}

export interface RoomMode {
  id: StudyMode
  label: string
  isCoding: boolean
  defaultFeedbackMode: FeedbackMode
}

/**
 * 학습 공간. 데스크톱은 자료(왼쪽)와 대화(오른쪽, 여백의 메모처럼)를 함께,
 * 모바일은 탭으로.
 *
 * 받는 데이터는 `loadSessionView` 의 공개 뷰뿐이다 — 미공개 해설은 여기 오지 않는다.
 */
export function StudyRoom({ view, mode }: { view: SessionView; mode: RoomMode }) {
  const st = MODE_STYLE[mode.id]
  const latest = view.materials.at(-1)
  const [versionId, setVersionId] = useState<number | null>(null)
  const [tab, setTab] = useState<'material' | 'chat'>('material')
  const [focusId, setFocusId] = useState<number | null>(null)

  // 새 자료가 생기면 기본은 최신이다. 학습자가 고른 버전이 있으면 그것을 지킨다.
  const material = view.materials.find((m) => m.id === versionId) ?? latest
  const allProblems = view.materials.flatMap((m) => m.problems)
  const focused = allProblems.find((p) => p.id === focusId) ?? null

  return (
    <>
      <div role="tablist" className="sticky top-0 z-10 -mx-4 mt-6 grid grid-cols-2 border-b border-rule bg-paper/90 px-4 backdrop-blur lg:hidden">
        {(['material', 'chat'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`h-11 border-b-2 text-[13.5px] transition-colors ${tab === t ? `${st.border} text-ink` : 'border-transparent text-faint'}`}>
            {t === 'material' ? '자료' : `대화 · ${view.messages.length}`}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className={`flex min-w-0 flex-col gap-6 ${tab === 'material' ? '' : 'hidden lg:flex'}`}>
          {view.materials.length > 1 && (
            <div className="flex items-center gap-3" aria-label="자료 버전">
              <span className="font-mono text-[10px] tracking-[0.22em] text-faint">판</span>
              <div className="flex flex-wrap gap-1.5">
                {view.materials.map((m) => (
                  <button key={m.id} type="button" onClick={() => setVersionId(m.id)}
                    className={`h-7 min-w-9 rounded-full px-3 font-mono text-[11px] transition-colors ${m.id === material?.id ? `${st.bg} text-paper` : 'bg-chip text-muted hover:text-ink'}`}>
                    v{m.version}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!material ? (
            <p className="rounded-card border border-dashed border-rule-strong px-6 py-14 text-center text-[13.5px] leading-relaxed text-muted">
              아직 자료가 없다.<br />대화에서 질문에 답하면 자료가 만들어진다.
            </p>
          ) : (
            <>
              <article key={material.id} className="animate-rise rounded-card bg-surface px-5 pt-8 pb-9 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-10">
                <header className="flex items-start justify-between gap-4">
                  <div>
                    <p className={`font-mono text-[10px] tracking-[0.24em] ${st.text}`}>자료 · v{material.version}</p>
                    <h2 className="mt-2 text-balance font-serif text-[28px] leading-[1.25] tracking-[-0.02em] text-ink">{material.title}</h2>
                  </div>
                  <span aria-hidden className={`font-serif text-[44px] leading-none opacity-20 ${st.text}`}>{st.glyph}</span>
                </header>

                <div className="mt-8 flex flex-col">
                  {material.blocks.map((b, i) => (
                    <section key={i} className="grid grid-cols-1 gap-x-6 border-t border-rule-soft py-6 first:border-0 first:pt-0 sm:grid-cols-[64px_minmax(0,1fr)]">
                      {/* 여백의 표제. 교재의 난외주처럼 */}
                      <p className="font-mono text-[10px] tracking-[0.22em] text-faint sm:pt-1.5">{BLOCK_LABEL[b.kind] ?? b.kind}</p>
                      <div className="min-w-0">
                        {b.title && <h3 className="font-serif text-[19px] leading-snug text-ink">{b.title}</h3>}
                        <Md className={b.title ? 'mt-2.5' : ''}>{b.body_md}</Md>
                      </div>
                    </section>
                  ))}
                </div>
              </article>

              {material.problems.length > 0 && (
                <div className="mt-2 flex items-center gap-4">
                  <span className="font-mono text-[10px] tracking-[0.24em] text-faint">연습 · {material.problems.length}문제</span>
                  <span className="h-px grow bg-rule" />
                </div>
              )}

              {material.problems.map((p) => (
                <ProblemCard
                  key={p.id}
                  sessionId={view.session.id}
                  problem={p}
                  submissions={view.submissions[p.id] ?? []}
                  isCoding={mode.isCoding}
                  defaultFeedbackMode={mode.defaultFeedbackMode}
                  focused={p.id === focusId}
                  onFocus={() => setFocusId(p.id)}
                  modeId={mode.id}
                />
              ))}
            </>
          )}
        </div>

        <div className={`min-w-0 lg:sticky lg:top-6 lg:self-start ${tab === 'chat' ? '' : 'hidden lg:block'}`}>
          <ChatPanel
            sessionId={view.session.id}
            messages={view.messages}
            focus={focused ? { id: focused.id, number: focused.number } : null}
            onClearFocus={() => setFocusId(null)}
            modeId={mode.id}
          />
        </div>
      </div>
    </>
  )
}
