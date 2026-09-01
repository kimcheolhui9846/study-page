import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadProgress, loadUsage, type SubjectProgress } from '@/lib/study/progress'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

/** USD 마이크로 단위를 사람이 읽는 금액으로. 부동소수는 표시 직전에만 쓴다. */
function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

const STATE_STYLE = {
  none: { dot: 'ring-[1.5px] ring-ghost', text: 'text-faint', label: '아직 시작 전' },
  in_progress: { dot: 'bg-warn', text: 'text-warn', label: '푸는 중' },
  completed: { dot: 'bg-ok', text: 'text-ok', label: '오늘 마쳤다' },
  abandoned: { dot: 'bg-stop', text: 'text-stop', label: '중단됨' },
} as const

function SubjectCard({ p }: { p: SubjectProgress }) {
  const style = STATE_STYLE[p.today]
  const done = Math.max(0, p.dayNo - 1)
  const finished = p.entry === null

  return (
    <li
      className={`flex flex-col items-center rounded-card bg-surface px-7 pt-9 pb-7 text-center transition-shadow ${
        p.today === 'in_progress'
          ? 'shadow-[inset_0_0_0_1.5px_var(--color-ghost)]'
          : 'shadow-[inset_0_0_0_1px_var(--color-rule)]'
      }`}
    >
      <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
        {finished ? `완주 ${p.totalDays}` : `DAY ${p.dayNo} / ${p.totalDays}`}
      </span>

      <h2 className="mt-3 font-serif text-[27px] leading-tight tracking-[-0.02em] text-ink">
        {p.label}
      </h2>

      <div className="mt-6 h-[2px] w-full rounded-sm bg-rule-soft">
        <div
          className={`h-[2px] rounded-sm ${p.today === 'completed' ? 'bg-ok' : p.today === 'in_progress' ? 'bg-warn' : 'bg-ghost'}`}
          style={{ width: `${Math.round((done / p.totalDays) * 100)}%` }}
        />
      </div>

      {finished ? (
        <p className="mt-7 grow text-balance text-[14.5px] leading-[1.7] text-body">커리큘럼을 다 마쳤다.</p>
      ) : (
        <>
          <p className="mt-7 text-balance text-[15px] leading-[1.6] tracking-[-0.01em] text-body">
            {p.entry!.topic}
          </p>
          <p className="mt-2.5 grow text-pretty text-[12.5px] leading-[1.75] text-faint">{p.entry!.goal}</p>
        </>
      )}

      <div className="mt-7 flex items-center gap-2">
        <span className={`size-[6px] shrink-0 rounded-full ${style.dot}`} />
        <span className={`text-[12.5px] tracking-[0.01em] ${style.text}`}>{style.label}</span>
      </div>

      <Link
        href={`/study/${p.subject}`}
        className="mt-5 flex h-11 w-full items-center justify-center rounded-control bg-ink text-[13.5px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90"
      >
        {p.today === 'completed' ? '다시 보기' : p.today === 'in_progress' ? '이어서 하기' : '시작하기'}
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

  const [progress, usage] = await Promise.all([
    loadProgress(db, systemClock),
    loadUsage(db, systemClock),
  ])

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
            과목마다 하루 한 번. 시작하면 그날의 지문이 만들어지고, 같은 날 다시 만들 수는 없다.
          </p>
        </div>

        <ul className="mt-16 grid grid-cols-3 gap-6">
          {progress.map((p) => (
            <SubjectCard key={p.subject} p={p} />
          ))}
        </ul>

        <div className="grow" />

        <div className="mx-auto mt-20 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
            오늘 호출 {usage.dailyCalls} / {usage.dailyCap}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">
              이번 달 {usd(usage.monthlyCostMicros)} / {usd(usage.monthlyCapMicros)}
            </span>
            <div className="h-[2px] w-20 rounded-sm bg-rule-soft">
              <div
                className="h-[2px] rounded-sm bg-ok"
                style={{
                  width: `${Math.min(100, Math.round((usage.monthlyCostMicros / usage.monthlyCapMicros) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
