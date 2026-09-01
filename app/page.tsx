import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
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
  none: { dot: 'border-[1.5px] border-ghost', text: 'text-faint', label: '아직 시작 전' },
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
      className={`flex flex-col rounded-card bg-surface px-[22px] pt-6 pb-[22px] ${
        p.today === 'in_progress' ? 'border-[1.5px] border-ghost' : 'border border-rule'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-[22px] text-ink">{p.label}</h2>
        <span className="font-mono text-[11.5px] text-faint">
          {finished ? `완주 ${p.totalDays}` : `DAY ${p.dayNo} / ${p.totalDays}`}
        </span>
      </div>

      <div className="mt-4 h-[3px] rounded-sm bg-rule-soft">
        <div
          className={`h-[3px] rounded-sm ${p.today === 'completed' ? 'bg-ok' : p.today === 'in_progress' ? 'bg-warn' : 'bg-ghost'}`}
          style={{ width: `${Math.round((done / p.totalDays) * 100)}%` }}
        />
      </div>

      {finished ? (
        <p className="mt-5 grow text-[15px] leading-[1.6] text-body">커리큘럼을 다 마쳤다.</p>
      ) : (
        <>
          <p className="mt-5 text-[15px] leading-[1.6] text-body">{p.entry!.topic}</p>
          <p className="mt-1.5 grow text-[13px] leading-[1.65] text-faint">{p.entry!.goal}</p>
        </>
      )}

      <div className="mt-[22px] flex items-center gap-[7px]">
        <span className={`size-[7px] shrink-0 rounded-full ${style.dot}`} />
        <span className={`text-[13px] ${style.text}`}>{style.label}</span>
      </div>

      <button
        disabled
        className="mt-3.5 h-10 cursor-not-allowed rounded-control border border-rule text-sm text-ghost"
      >
        {p.today === 'completed' ? '다시 보기' : p.today === 'in_progress' ? '이어서 하기' : '시작하기'}
      </button>
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

      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-8 pt-14 pb-10">
        <div className="font-mono text-xs tracking-[0.14em] text-faint">
          {kstDateLabel(systemClock.now())}
        </div>

        <h1 className="mt-3.5 font-serif text-[38px] leading-tight text-ink">오늘</h1>

        <p className="mt-2.5 text-[14.5px] leading-[1.7] text-muted">
          과목마다 하루 한 번. 시작하면 그날의 지문이 만들어지고, 같은 날 다시 만들 수는 없다.
        </p>

        <ul className="mt-10 grid grid-cols-3 gap-5">
          {progress.map((p) => (
            <SubjectCard key={p.subject} p={p} />
          ))}
        </ul>

        <div className="grow" />

        {/* 1주차에는 학습 화면이 없다. 이 줄은 2주차에 지운다. */}
        <p className="mt-12 text-[13px] leading-[1.7] text-faint">
          학습 화면은 2주차에 붙는다. 위의 진도와 아래의 사용량은 이미 실제 데이터다.
        </p>

        <div className="mt-4 h-px bg-rule" />

        <div className="mt-[18px] flex items-center justify-between gap-6">
          <span className="font-mono text-[11.5px] tracking-[0.1em] text-faint">
            오늘 호출 {usage.dailyCalls} / {usage.dailyCap}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-faint">
              이번 달 {usd(usage.monthlyCostMicros)} / {usd(usage.monthlyCapMicros)}
            </span>
            <div className="h-[3px] w-[120px] rounded-sm bg-rule-soft">
              <div
                className="h-[3px] rounded-sm bg-ok"
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
