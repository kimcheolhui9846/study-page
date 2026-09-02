import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { feasibility } from '@/lib/curriculum/overview'
import { loadDashboard } from '@/lib/progress/load'
import { loadUsage } from '@/lib/budget/usage'
import { formatUsd } from '@/lib/budget/report'
import type { RecentScore, SubjectProgress } from '@/lib/progress/summary'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

function SubjectCard({ s }: { s: SubjectProgress }) {
  return (
    <li className="flex flex-col items-center rounded-card bg-surface px-7 pt-8 pb-7 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <h2 className="font-serif text-[25px] leading-tight tracking-[-0.02em] text-ink">
        {s.label}
      </h2>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="font-serif text-[38px] leading-none tracking-[-0.03em] text-ink">
          {s.mastered}
        </span>
        <span className="font-mono text-[13px] text-faint">/ {s.total}</span>
      </div>

      {/* 진도 막대. 숙달 · 흔들림 · 진행 중을 한 줄에 겹쳐 보여준다 */}
      <div className="mt-5 flex h-[3px] w-full overflow-hidden rounded-sm bg-rule-soft">
        <div className="h-full bg-ok" style={{ width: `${(s.mastered / s.total) * 100}%` }} />
        <div className="h-full bg-warn" style={{ width: `${(s.inProgress / s.total) * 100}%` }} />
        <div className="h-full bg-stop" style={{ width: `${(s.weak / s.total) * 100}%` }} />
      </div>

      <p className="mt-4 font-mono text-[10.5px] tracking-[0.18em] text-faint">
        {s.percent}% 숙달
      </p>

      <ul className="mt-5 flex grow flex-col gap-1">
        {s.inProgress > 0 && (
          <li className="text-[12.5px] leading-[1.7] text-warn">배우는 중 {s.inProgress}</li>
        )}
        {s.weak > 0 && (
          <li className="text-[12.5px] leading-[1.7] text-stop">흔들림 {s.weak}</li>
        )}
        <li className="text-[12.5px] leading-[1.7] text-faint">아직 {s.notStarted}</li>
      </ul>

      <Link
        href={`/curriculum?subject=${s.subject}`}
        className="mt-6 flex h-10 w-full items-center justify-center rounded-control text-[12.5px] tracking-[0.04em] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:bg-paper hover:text-body"
      >
        커리큘럼 보기
      </Link>
    </li>
  )
}

function Stat({ label, value, note, tone = 'text-ink' }: {
  label: string; value: string; note?: string; tone?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="font-mono text-[10px] tracking-[0.22em] text-faint">{label}</span>
      <span className={`font-serif text-[30px] leading-none tracking-[-0.03em] ${tone}`}>
        {value}
      </span>
      <span className="text-[11.5px] leading-[1.6] text-faint">{note ?? ' '}</span>
    </div>
  )
}

function ScoreRow({ r }: { r: RecentScore }) {
  const tone = r.score >= 75 ? 'text-ok' : r.score >= 60 ? 'text-warn' : 'text-stop'

  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-rule-soft pb-2.5 last:border-0">
      <span className="truncate text-[13.5px] text-body">{r.title}</span>
      <span className="flex shrink-0 items-baseline gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-ghost">
          {r.studyDate.slice(5).replace('-', ' · ')}
        </span>
        <span className={`font-mono text-[13px] ${tone}`}>{r.score}</span>
      </span>
    </li>
  )
}

export default async function Dashboard() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const d = await loadDashboard(db, systemClock)
  const usage = await loadUsage(db, systemClock)
  const mastered = d.subjects.reduce((n, s) => n + s.mastered, 0)
  const total = d.subjects.reduce((n, s) => n + s.total, 0)

  /*
   * 아직 실제 속도를 못 재는 동안에는 커리큘럼이 담은 분량으로 답한다.
   * 둘은 다른 질문이다 — 이건 "목표가 애초에 가능한가", 페이스는 "지금
   * 그 속도로 가고 있는가". 잴 수 있게 되면 페이스가 이걸 대신한다.
   */
  const fit = d.pace.estimatedDays === null
    ? feasibility(loadGraph(), d.targetDayCount, d.dailyStudyMinutes)
    : null

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-5 pt-14 pb-14 sm:px-8 sm:pt-24">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {kstDateLabel(systemClock.now())}
          </div>

          <h1 className="mt-6 font-serif text-[40px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[52px]">
            오늘
          </h1>

          <p className="mx-auto mt-5 max-w-[440px] text-balance text-[14px] leading-[1.8] text-muted">
            어제 무엇을 틀렸는지가 오늘 무엇을 배울지를 바꾼다.
          </p>

          <Link
            href="/today"
            className="mx-auto mt-9 flex h-12 w-full max-w-[260px] items-center justify-center rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90"
          >
            오늘의 학습
          </Link>
        </div>

        {/* 계기판 — 진도 · 연속 · 복습 부담 · 예상 완료 */}
        <div className="mt-12 grid grid-cols-2 gap-y-8 rounded-card bg-surface px-6 py-8 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:mt-16 sm:grid-cols-4 sm:gap-6 sm:px-8 sm:py-9">
          <Stat
            label="숙달"
            value={`${mastered}`}
            note={total > 0 ? `전체 ${total}개 중` : '커리큘럼이 비어 있다'}
          />
          <Stat
            label="연속"
            value={d.streak === 0 ? '—' : `${d.streak}일`}
            note={
              d.streak === 0
                ? '오늘 시작하면 1일'
                : d.studiedToday
                  ? '오늘까지 이어졌다'
                  : `오늘 하면 ${d.streak + 1}일`
            }
            tone={d.streak === 0 ? 'text-faint' : 'text-ink'}
          />
          <Stat
            label="복습"
            value={`${d.reviews.due}`}
            note={d.reviews.upcoming > 0 ? `이번 주에 ${d.reviews.upcoming}개 더` : '오늘 기한'}
            tone={d.reviews.due > 0 ? 'text-warn' : 'text-faint'}
          />
          <Stat
            label="예상 완료"
            value={d.pace.estimatedDate?.slice(2).replaceAll('-', '.') ?? '—'}
            note={
              d.pace.estimatedDays === null
                ? `${d.pace.activeDays}일 공부했다 · 아직 재기 이르다`
                : `이 속도로 ${d.pace.estimatedDays}일 더`
            }
            tone={d.pace.estimatedDate ? 'text-ink' : 'text-faint'}
          />
        </div>

        {/*
          ★ 예상 완료일은 목표에서 역산한 값이 아니라 실제 속도로 잰 값이다.
          목표보다 늦으면 숨기지 않고 말한다.
        */}
        {d.pace.estimatedDays !== null && d.pace.estimatedDays > d.targetDayCount && (
          <p className="mt-4 text-center text-[12.5px] leading-relaxed text-warn">
            목표는 {d.targetDayCount}일인데 지금 속도로는 {d.pace.estimatedDays}일 걸린다 ·
            하루 {d.pace.perDay.toFixed(1)}개를 숙달하고 있다
          </p>
        )}

        <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
          {d.subjects.map((s) => (
            <SubjectCard key={s.subject} s={s} />
          ))}
        </ul>

        {d.recent.length > 0 && (
          <div className="mt-8 rounded-card bg-surface px-6 py-7 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-8">
            <h2 className="text-center font-mono text-[10px] tracking-[0.22em] text-faint">
              최근 채점
            </h2>
            <ul className="mt-6 flex flex-col gap-2.5">
              {d.recent.map((r) => (
                <ScoreRow key={`${r.topicId}-${r.studyDate}`} r={r} />
              ))}
            </ul>
          </div>
        )}

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link
              href="/settings"
              className="font-mono text-[10.5px] tracking-[0.22em] text-faint underline decoration-rule underline-offset-[6px] transition-colors hover:text-muted"
            >
              목표 {d.targetDayCount}일 · 하루 {d.dailyStudyMinutes}분
            </Link>
            {/* 이 앱의 제약은 돈이다. 대시보드에서 한 번은 보이게 둔다. */}
            <Link
              href="/admin/usage"
              className="font-mono text-[10.5px] tracking-[0.22em] text-faint underline decoration-rule underline-offset-[6px] transition-colors hover:text-muted"
            >
              이번 달 {formatUsd(usage.monthlyCostMicros)} · 오늘 {usage.dailyCalls}/{usage.dailyCap}회
            </Link>
          </div>
          {fit && (
            <span className={`text-[12.5px] ${fit.fits ? 'text-muted' : 'text-warn'}`}>
              {fit.fits
                ? `커리큘럼 분량으로는 ${fit.requiredDays}일치다`
                : `커리큘럼 분량이 ${fit.requiredDays}일치다 — 목표보다 ${fit.requiredDays - fit.targetDayCount}일 길다`}
            </span>
          )}
          {mastered === 0 && (
            <span className="text-balance text-center text-[12.5px] leading-relaxed text-muted">
              아직 채점된 것이 없다. 첫 하루를 마치면 여기에 숫자가 채워진다.
            </span>
          )}
        </div>
      </main>
    </>
  )
}
