'use client'

import { useState } from 'react'
import type { PublicProblem } from '@/lib/study/schemas'
import type { PublicSubmission } from '@/lib/study/store'
import type { FeedbackMode, StudyMode } from '@/lib/study/modes'
import { MODE_STYLE } from './modeStyle'
import { Md } from './Md'
import { StatusLine } from './StatusLine'
import { useDraft, useStudyAction } from './hooks'

const VERDICT: Record<string, { label: string; tone: string; edge: string }> = {
  correct: { label: '맞음', tone: 'text-ok', edge: 'border-ok' },
  partial: { label: '일부', tone: 'text-warn', edge: 'border-warn' },
  incorrect: { label: '틀림', tone: 'text-stop', edge: 'border-stop' },
}

const LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'kotlin', 'go', 'rust']

export interface ProblemCardProps {
  sessionId: number
  problem: PublicProblem
  submissions: PublicSubmission[]
  isCoding: boolean
  defaultFeedbackMode: FeedbackMode
  focused: boolean
  onFocus: () => void
  modeId: StudyMode
}

function Submission({ s }: { s: PublicSubmission }) {
  const v = VERDICT[s.verdict] ?? { label: s.verdict, tone: 'text-muted', edge: 'border-rule-strong' }
  const f = s.feedback
  return (
    <li className={`animate-rise border-l-2 bg-note py-3.5 pr-4 pl-4 ${v.edge}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10.5px] tracking-[0.1em] text-faint">
        <span className={`font-serif text-[15px] tracking-normal ${v.tone}`}>{v.label}</span>
        <span>{s.attemptNo}차</span>
        {f.totalCount > 0 && <span>기준 {f.correctCount}/{f.totalCount}</span>}
        <span>{f.reviewLabel}{s.feedbackMode === 'errors-only' ? ' · 오류만' : ''}</span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-faint">제출한 답</summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 font-mono text-[12.5px] text-body">{s.answer}</pre>
      </details>
      {f.summary_md && <Md className="mt-3">{f.summary_md}</Md>}
      {f.issues.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {f.issues.map((x, i) => (
            <li key={i} className="text-[13.5px] leading-relaxed text-body">
              <span className="font-mono text-[11.5px] text-stop">{x.where}</span>
              <Md>{x.why}</Md>
              {x.fix_hint && <Md className="text-muted">{`→ ${x.fix_hint}`}</Md>}
            </li>
          ))}
        </ul>
      )}
      {f.improved_md && (
        <div className="mt-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-faint">고친 답</p>
          <Md className="mt-1">{f.improved_md}</Md>
        </div>
      )}
    </li>
  )
}

export function ProblemCard(p: ProblemCardProps) {
  const pr = p.problem
  const st = MODE_STYLE[p.modeId]
  const [answer, setAnswer, clearAnswer] = useDraft(`answer:${p.sessionId}:${pr.id}`)
  const [language, setLanguage] = useState('python')
  const [mode, setMode] = useState<FeedbackMode>(p.defaultFeedbackMode)
  const [confirmReveal, setConfirmReveal] = useState(false)
  const submit = useStudyAction()
  const free = useStudyAction()

  async function send() {
    const r = await submit.run(`/api/study/sessions/${p.sessionId}/submit`, {
      problemId: pr.id, answer, language: p.isCoding ? language : null, feedbackMode: mode,
    })
    if (r.state === 'ok') clearAnswer()
  }

  return (
    <article
      id={`problem-${pr.number}`}
      onClick={p.onFocus}
      className={`scroll-mt-20 rounded-card bg-surface px-5 py-6 transition-shadow sm:px-7 sm:py-7 ${p.focused ? st.ring : 'shadow-[inset_0_0_0_1px_var(--color-rule)]'}`}
    >
      <div className="flex gap-4 sm:gap-5">
        {/* 큰 번호. 「2번 문제」라고 말할 때 눈이 찾는 자리다 */}
        <span aria-hidden className={`font-serif text-[40px] leading-[0.9] tracking-[-0.04em] sm:text-[48px] ${p.focused ? st.text : 'text-rule-strong'}`}>
          {pr.number}
        </span>
        <div className="min-w-0 grow">
          <header className="flex items-baseline justify-between gap-3">
            <h3 className="sr-only">{pr.number}번 문제</h3>
            {p.focused && <span className={`font-mono text-[10px] tracking-[0.2em] ${st.text}`}>대화가 이 문제를 가리킨다</span>}
          </header>
          <Md>{pr.prompt_md}</Md>
        </div>
      </div>

      {pr.spec && (
        <dl className="mt-4 grid grid-cols-1 gap-3 text-[13.5px] sm:grid-cols-2">
          {([['입력', pr.spec.input_md], ['출력', pr.spec.output_md], ['제약', pr.spec.constraints_md], ['예시', pr.spec.examples_md]] as const)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="rounded-control bg-note px-3 py-2.5">
                <dt className="font-mono text-[10px] tracking-[0.2em] text-faint">{k}</dt>
                <dd className="mt-1"><Md>{v}</Md></dd>
              </div>
            ))}
        </dl>
      )}

      {pr.hints.length > 0 && (
        <ol className="mt-4 flex flex-col gap-1.5">
          {pr.hints.map((h, i) => (
            <li key={i} className="rounded-control bg-warn-tint px-3 py-2 text-[13.5px] text-body">
              <span className="mr-2 font-mono text-[10.5px] text-warn">힌트 {i + 1}</span>{h}
            </li>
          ))}
        </ol>
      )}

      {pr.solution && (
        <div className="mt-4 rounded-control bg-ok-tint px-4 py-3.5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-ok">해설</p>
          <Md className="mt-2">{pr.solution.answer_md}</Md>
          {pr.solution.solution_md && <Md className="mt-3">{pr.solution.solution_md}</Md>}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        {p.isCoding && (
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="언어"
            className="w-36 rounded-control bg-paper px-2 py-1.5 font-mono text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-rule)]"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={p.isCoding ? 10 : 4}
          maxLength={20000}
          spellCheck={!p.isCoding}
          placeholder={p.isCoding ? '코드를 붙여 넣는다' : '답과 풀이를 쓴다'}
          aria-label={`${pr.number}번 답안`}
          className={`w-full resize-y rounded-control bg-paper px-3.5 py-3 text-body shadow-[inset_0_0_0_1px_var(--color-rule)] outline-none placeholder:text-ghost focus:shadow-[inset_0_0_0_1px_var(--color-rule-strong)] ${p.isCoding ? 'font-mono text-[13px] leading-[1.6]' : 'text-[14.5px] leading-relaxed'}`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={send}
            disabled={submit.status.busy || answer.trim().length === 0}
            className={`h-9 rounded-control px-5 text-[13px] text-paper transition-all hover:brightness-110 disabled:opacity-35 ${st.bg}`}
          >
            제출
          </button>
          <div role="radiogroup" aria-label="피드백 깊이" className="flex overflow-hidden rounded-control shadow-[inset_0_0_0_1px_var(--color-rule)]">
            {(['errors-only', 'full'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`h-9 px-3 text-[12px] ${mode === m ? 'bg-chip text-ink' : 'text-faint'}`}
              >
                {m === 'errors-only' ? '오류만' : '고친 답까지'}
              </button>
            ))}
          </div>
          <span className="grow" />
          <button
            type="button"
            onClick={() => free.run(`/api/study/problems/${pr.id}/hint`, {}, { paid: false })}
            disabled={free.status.busy || pr.hintsLeft === 0}
            className="h-9 rounded-control px-3 text-[12.5px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] hover:bg-paper disabled:opacity-40"
          >
            힌트 ({pr.hints.length}/{pr.hints.length + pr.hintsLeft})
          </button>
          {!pr.solution && (confirmReveal ? (
            <button
              type="button"
              onClick={() => free.run(`/api/study/problems/${pr.id}/reveal`, {}, { paid: false })}
              className="h-9 rounded-control bg-warn-tint px-3 text-[12.5px] text-warn shadow-[inset_0_0_0_1px_var(--color-warn-rule)]"
            >
              정말 해설을 연다
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReveal(true)}
              className="h-9 rounded-control px-3 text-[12.5px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] hover:bg-paper"
            >
              해설 보기
            </button>
          ))}
        </div>
        <StatusLine status={submit.status} busyText="답을 검토하는 중이다…" onRetry={send} />
        <StatusLine status={free.status} busyText="여는 중…" />
      </div>

      {p.submissions.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3">
          {[...p.submissions].reverse().map((s) => <Submission key={s.id} s={s} />)}
        </ul>
      )}
    </article>
  )
}
