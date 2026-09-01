import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { subjectLabel } from '@/lib/curriculum/overview'
import type { Subject } from '@/lib/curriculum/schema'
import { PARK_DAYS } from '@/lib/mastery/recovery'
import { loadTopicDetail, type RelatedTopic, type TopicDetail } from '@/lib/progress/topic'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  not_started: { label: '아직 안 배웠다', className: 'text-faint' },
  learning: { label: '배우는 중', className: 'text-warn' },
  reviewing: { label: '복습 중', className: 'text-warn' },
  weak: { label: '흔들린다', className: 'text-stop' },
  mastered: { label: '숙달', className: 'text-ok' },
}

/** 회복 단계를 사람 말로. 「왜 오늘 또 나왔나」의 답이다. */
const RECOVERY_COPY: Record<string, string> = {
  retry: '한 번 더 스스로 해본다. 원래 지문을 다시 읽으므로 AI 호출은 없다.',
  remediation: '기초가 흔들린다. 아래 선수 개념을 먼저 넘긴 뒤에 다시 온다.',
  'final-retry': '기초를 보충했다. 마지막으로 한 번 더 보고, 결과와 무관하게 다음 진도로 간다.',
  parked: `세 번 했는데 못 넘겼다. 지금은 접어두고 ${PARK_DAYS}일 뒤에 다시 온다.`,
}

function Related({ r }: { r: RelatedTopic }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-rule-soft pb-2.5 last:border-0">
      <Link
        href={`/topic/${encodeURIComponent(r.id)}`}
        className="truncate text-[13.5px] text-body underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule-strong"
      >
        {/* 과목을 넘는 관계는 눈에 띄어야 한다. 진도가 막힌 이유가 대개 여기다. */}
        {r.crossing && <span className="text-warn">{r.subject} · </span>}
        {r.title}
      </Link>
      <span
        className={`shrink-0 font-mono text-[11.5px] ${r.passed ? 'text-ok' : 'text-faint'}`}
      >
        {r.score} / {r.passThreshold}
      </span>
    </li>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card bg-surface px-8 py-7 shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <h2 className="text-center font-mono text-[10px] tracking-[0.22em] text-faint">{title}</h2>
      <div className="mt-6">{children}</div>
    </div>
  )
}

function Progress({ d }: { d: TopicDetail }) {
  const st = d.progress
  const status = STATUS_LABEL[st?.status ?? 'not_started']!

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[44px] leading-none tracking-[-0.03em] text-ink">
          {st?.masteryScore ?? 0}
        </span>
        <span className="font-mono text-[13px] text-faint">/ {d.topic.passThreshold}</span>
      </div>

      <span className={`font-mono text-[11px] tracking-[0.18em] ${status.className}`}>
        {status.label}
      </span>

      {st && (
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 font-mono text-[10.5px] tracking-[0.14em] text-faint">
          <span>{st.attemptCount}번 봤다</span>
          {st.wrongCount > 0 && <span className="text-stop">{st.wrongCount}번 못 넘겼다</span>}
          {st.nextReviewAt && <span>복습 {st.nextReviewAt}</span>}
          {st.reviewRound > 0 && <span>{st.reviewRound}회차</span>}
        </div>
      )}

      {st?.weakConcepts && st.weakConcepts.length > 0 && (
        <div className="mt-2 flex w-full flex-col gap-2 rounded-control bg-stop-tint px-5 py-4">
          <span className="font-mono text-[10px] tracking-[0.18em] text-stop">
            반복해서 틀린 것
          </span>
          {st.weakConcepts.map((w) => (
            <span key={w} className="text-pretty text-[13px] leading-[1.7] text-body">
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default async function TopicPage(
  { params }: { params: Promise<{ topicId: string }> },
) {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const { topicId: raw } = await params
  const d = await loadTopicDetail(db, systemClock, decodeURIComponent(raw))
  if (!d) notFound()

  const graph = loadGraph()
  const blocking = d.prerequisites.filter((p) => !p.passed)

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-8 pt-24 pb-20">
        <div className="text-center">
          <Link
            href={`/curriculum?subject=${d.topic.subject}`}
            className="font-mono text-[11px] tracking-[0.22em] text-faint underline decoration-rule underline-offset-[6px] transition-colors hover:text-muted"
          >
            {subjectLabel(graph, d.topic.subject as Subject)} · {d.topic.domainLabel}
          </Link>

          <h1 className="mt-6 text-balance font-serif text-[40px] leading-[1.15] tracking-[-0.03em] text-ink">
            {d.topic.title}
          </h1>

          <p className="mx-auto mt-5 max-w-[440px] text-balance text-[13.5px] leading-[1.8] text-muted">
            {d.topic.goal}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[10.5px] tracking-[0.14em] text-faint">
            <span>난이도 {'●'.repeat(d.topic.difficulty)}{'○'.repeat(5 - d.topic.difficulty)}</span>
            <span>{d.topic.estimatedMinutes}분</span>
            <span>{d.topic.keywords.join(' · ')}</span>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-6">
          <Panel title="진도">
            <Progress d={d} />
          </Panel>

          {/* ★ 「왜 오늘 또 나왔나」 · 「왜 안 나오나」의 답 */}
          {d.recovery && (
            <div className="rounded-card bg-note px-8 py-6">
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted">
                지금 무엇을 하나
              </span>
              <p className="mt-3 text-pretty text-[13.5px] leading-[1.8] text-body">
                {RECOVERY_COPY[d.recovery.phase]}
              </p>
            </div>
          )}

          {!d.unlocked && (
            <div className="rounded-card bg-note px-8 py-6">
              <span className="font-mono text-[10px] tracking-[0.22em] text-warn">
                아직 안 열렸다
              </span>
              {/* 조사를 피한다. 마지막 글자에 따라 은/는·을/를이 갈리는데
                  제목이 무엇일지 모르므로 "을(를)"로 도망가지 않는다. */}
              <p className="mt-3 text-pretty text-[13.5px] leading-[1.8] text-body">
                먼저 넘겨야 하는 것 — {blocking.map((b) => b.title).join(' · ')}
              </p>
            </div>
          )}

          {d.prerequisites.length > 0 && (
            <Panel title="먼저 알아야 하는 것">
              <ul className="flex flex-col gap-2.5">
                {d.prerequisites.map((p) => <Related key={p.id} r={p} />)}
              </ul>
            </Panel>
          )}

          {d.unlocks.length > 0 && (
            <Panel title={`이걸 넘기면 열리는 것 ${d.unlocks.length}개`}>
              <ul className="flex flex-col gap-2.5">
                {d.unlocks.map((u) => <Related key={u.id} r={u} />)}
              </ul>
            </Panel>
          )}

          {d.connections.length > 0 && (
            <Panel title="왜 이걸 배우나">
              <ul className="flex flex-col gap-3">
                {d.connections.map((c) => (
                  <li key={c.note} className="text-pretty text-[13.5px] leading-[1.8] text-body">
                    {c.note}
                    <span className="ml-2 font-mono text-[10.5px] text-ghost">{c.otherTitle}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {d.history.length > 0 && (
            <Panel title="기록">
              <ul className="flex flex-col gap-2.5">
                {d.history.map((h) => (
                  <li
                    key={`${h.studyDate}-${h.round ?? 'x'}`}
                    className="flex items-baseline justify-between gap-4 border-b border-rule-soft pb-2.5 last:border-0"
                  >
                    <span className="font-mono text-[11.5px] tracking-[0.14em] text-muted">
                      {h.studyDate}
                    </span>
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-[10.5px] tracking-[0.14em] text-ghost">
                        {h.kind === 'review' && h.round === null ? '다시 배우기'
                          : h.kind === 'review' ? `복습 ${h.round}회차`
                          : h.kind === 'remediation' ? '보충' : '새로'}
                      </span>
                      <span
                        className={`font-mono text-[13px] ${
                          h.score >= d.topic.passThreshold ? 'text-ok' : 'text-warn'
                        }`}
                      >
                        {h.score}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          {d.inTodaysPlan ? (
            <Link
              href={`/today/${encodeURIComponent(d.topic.id)}`}
              className="flex h-12 w-full max-w-[260px] items-center justify-center rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90"
            >
              오늘 이걸 한다
            </Link>
          ) : (
            <span className="text-balance text-center text-[12.5px] leading-relaxed text-faint">
              오늘 계획에 없다. 학습은 계획에 담긴 것만 할 수 있다.
            </span>
          )}

          <span className="font-mono text-[10px] tracking-[0.18em] text-ghost">
            {d.hasMaterial ? '자료가 이미 있다 · 다시 열어도 AI 호출 0회' : '자료를 아직 안 만들었다'}
          </span>
        </div>
      </main>
    </>
  )
}
