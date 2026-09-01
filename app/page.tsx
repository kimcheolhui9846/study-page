import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { feasibility, overview, type SubjectOverview } from '@/lib/curriculum/overview'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

/**
 * 2단계에서 users 테이블이 생기면 거기서 읽는다.
 * 지금은 커리큘럼이 무엇을 담고 있는지만 보여주므로 기본값으로 충분하다.
 */
const TARGET_DAYS = 90
const DAILY_MINUTES = 60

function hours(minutes: number): string {
  return `${Math.round(minutes / 60)}시간`
}

function SubjectCard({ s }: { s: SubjectOverview }) {
  return (
    <li className="flex flex-col items-center rounded-card bg-surface px-7 pt-9 pb-7 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
      <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
        {s.domains.length}개 영역
      </span>

      <h2 className="mt-3 font-serif text-[27px] leading-tight tracking-[-0.02em] text-ink">
        {s.label}
      </h2>

      <div className="mt-6 h-[2px] w-full rounded-sm bg-rule-soft" />

      <p className="mt-7 text-[15px] leading-[1.6] text-body">
        주제 {s.topicCount}개 · {hours(s.totalMinutes)}
      </p>

      <ul className="mt-4 flex grow flex-col gap-1.5">
        {s.domains.map((d) => (
          <li key={d.domain} className="text-[12.5px] leading-[1.7] text-faint">
            {d.label} <span className="text-ghost">{d.topics.length}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/curriculum?subject=${s.subject}`}
        className="mt-7 flex h-11 w-full items-center justify-center rounded-control bg-ink text-[13.5px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90"
      >
        커리큘럼 보기
      </Link>
    </li>
  )
}

export default async function Dashboard() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const graph = loadGraph()
  const subjects = overview(graph, TARGET_DAYS)
  const fit = feasibility(graph, TARGET_DAYS, DAILY_MINUTES)

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-8 pt-24 pb-12">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {kstDateLabel(systemClock.now())}
          </div>

          <h1 className="mt-6 font-serif text-[52px] leading-[1.1] tracking-[-0.03em] text-ink">
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

        <ul className="mt-16 grid grid-cols-3 gap-6">
          {subjects.map((s) => (
            <SubjectCard key={s.subject} s={s} />
          ))}
        </ul>

        <div className="grow" />

        <div className="mx-auto mt-20 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
            목표 {fit.targetDayCount}일 · 하루 {DAILY_MINUTES}분
          </span>
          <span className={`text-[12.5px] ${fit.fits ? 'text-muted' : 'text-warn'}`}>
            {fit.fits
              ? `이 속도면 ${fit.requiredDays}일 걸린다`
              : `이 속도면 ${fit.requiredDays}일 걸린다 — 목표보다 ${fit.requiredDays - fit.targetDayCount}일 길다`}
          </span>
        </div>
      </main>
    </>
  )
}
