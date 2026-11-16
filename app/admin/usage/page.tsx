import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstTimeLabel, kstToday, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadUsageReport, type UsageReport } from '@/lib/budget/ledger'
import { formatUsd, type DayCost, type LedgerRow, type RouteCost } from '@/lib/budget/report'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

/** 경로 이름을 사람 말로. 'content' 라고 적어두면 나중의 내가 못 읽는다. */
const ROUTE_LABEL: Record<string, string> = {
  content: '새 자료 생성',
  review: '복습 자료 생성',
  grade: '채점',
}

function Panel({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-card bg-surface px-5 py-6 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-8 sm:py-7">
      <h2 className="text-center font-mono text-[10px] tracking-[0.22em] text-faint">{title}</h2>
      {note && (
        <p className="mx-auto mt-4 max-w-[420px] text-balance text-center text-[12.5px] leading-[1.8] text-muted">
          {note}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </div>
  )
}

function Stat({ label, value, note, tone = 'text-ink' }: {
  label: string; value: string; note?: string; tone?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="font-mono text-[10px] tracking-[0.22em] text-faint">{label}</span>
      <span className={`font-mono text-[19px] leading-none tracking-[-0.01em] ${tone}`}>
        {value}
      </span>
      <span className="text-[11.5px] leading-[1.6] text-faint">{note ?? ' '}</span>
    </div>
  )
}

function RouteRow({ r, max }: { r: RouteCost; max: number }) {
  return (
    <li className="flex flex-col gap-2 border-b border-rule-soft pb-4 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13.5px] text-body">{ROUTE_LABEL[r.route] ?? r.route}</span>
        <span className="shrink-0 font-mono text-[13px] text-ink">{formatUsd(r.costMicros)}</span>
      </div>

      <div className="h-[3px] w-full overflow-hidden rounded-sm bg-rule-soft">
        <div
          className="h-full bg-ink"
          style={{ width: `${max === 0 ? 0 : (r.costMicros / max) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] tracking-[0.14em] text-faint">
        <span>{r.calls}회</span>
        <span>평균 {formatUsd(r.avgMicros)}</span>
        <span>토큰 {(r.promptTokens + r.completionTokens).toLocaleString()}</span>
        {/* ★ 돈은 나갔는데 결과가 없는 호출. 묻어두지 않는다 */}
        {r.failed > 0 && <span className="text-stop">실패 {r.failed}회</span>}
      </div>
    </li>
  )
}

function DayRow({ d, max }: { d: DayCost; max: number }) {
  return (
    <li className="flex items-center gap-3 sm:gap-4">
      <span className="w-[52px] shrink-0 font-mono text-[10.5px] tracking-[0.14em] text-faint">
        {d.date.slice(5).replace('-', '·')}
      </span>

      <span className="h-[3px] grow overflow-hidden rounded-sm bg-rule-soft">
        <span
          className={`block h-full ${d.failed > 0 ? 'bg-stop' : 'bg-ink'}`}
          style={{ width: `${max === 0 ? 0 : (d.costMicros / max) * 100}%` }}
        />
      </span>

      <span className="w-[42px] shrink-0 text-right font-mono text-[10.5px] text-ghost">
        {d.calls}회
      </span>
      <span className="w-[74px] shrink-0 text-right font-mono text-[11.5px] text-muted">
        {formatUsd(d.costMicros)}
      </span>
    </li>
  )
}

function CallRow({ r }: { r: LedgerRow }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-rule-soft pb-2.5 last:border-0">
      <span className="flex min-w-0 items-baseline gap-2.5">
        {/* 날짜를 같이 준다. 시각만 있으면 22:14 가 어제 것인지 알 수 없다.
            둘 다 KST 다 — 원장은 UTC 로 저장된다. */}
        <span className="shrink-0 font-mono text-[10.5px] tracking-[0.14em] text-ghost">
          {kstToday(r.createdAt).slice(5).replace('-', '·')} {kstTimeLabel(r.createdAt)}
        </span>
        <span className={`truncate text-[12.5px] ${r.ok ? 'text-body' : 'text-stop'}`}>
          {ROUTE_LABEL[r.route] ?? r.route}
          {r.subject && <span className="text-faint"> · {r.subject}</span>}
          {!r.ok && ' — 실패'}
        </span>
      </span>

      <span className="shrink-0 font-mono text-[11.5px] text-muted">
        {formatUsd(r.costMicros ?? 0)}
      </span>
    </li>
  )
}

function Money({ u }: { u: UsageReport }) {
  const b = u.burn

  return (
    <>
      <div className="mt-12 grid grid-cols-2 gap-y-8 rounded-card bg-surface px-5 py-8 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:mt-16 sm:grid-cols-4 sm:gap-6 sm:px-8 sm:py-9">
        <Stat
          label="이번 달"
          value={formatUsd(b.spentMicros)}
          note={`캡 ${formatUsd(b.capMicros)} 의 ${b.percent}%`}
          tone={b.percent >= 80 ? 'text-stop' : b.percent >= 50 ? 'text-warn' : 'text-ink'}
        />
        <Stat
          label="오늘 호출"
          value={`${u.dailyCalls} / ${u.dailyCap}`}
          note={
            u.dailyCalls >= u.dailyCap
              ? '오늘은 여기까지다'
              : `${u.dailyCap - u.dailyCalls}번 남았다`
          }
          tone={u.dailyCalls >= u.dailyCap ? 'text-stop' : 'text-ink'}
        />
        <Stat
          label="월말 예상"
          value={formatUsd(b.projectedMicros)}
          note={`${b.elapsedDays}일치로 잰 속도`}
          tone={b.exceedsCap ? 'text-stop' : 'text-ink'}
        />
        <Stat
          label="누적"
          value={formatUsd(u.totalCostMicros)}
          note={`호출 ${u.totalCalls}회`}
        />
      </div>

      {/* 이번 달 캡이 어디까지 찼나 */}
      <div className="mt-5 h-[3px] w-full overflow-hidden rounded-sm bg-rule-soft">
        <div
          className={`h-full ${b.percent >= 80 ? 'bg-stop' : b.percent >= 50 ? 'bg-warn' : 'bg-ok'}`}
          style={{ width: `${b.percent}%` }}
        />
      </div>

      {/*
        ★ 캡에 닿을 것 같으면 닿기 전에 말한다.
        다 쓰고 429 를 보는 것과 며칠 남았는지 미리 아는 것은 다르다.
      */}
      {b.daysUntilCap !== null && (
        <p className="mt-4 text-center text-[12.5px] leading-relaxed text-stop">
          {b.daysUntilCap === 0
            ? '이번 달 예산을 다 썼다. 다음 달 1일에 카운터가 새로 열린다.'
            : `이 속도면 ${b.daysUntilCap}일 뒤에 이번 달 예산이 찬다.`}
        </p>
      )}

      {b.daysUntilCap === null && b.exceedsCap && (
        <p className="mt-4 text-center text-[12.5px] leading-relaxed text-warn">
          월말 예상이 캡을 넘는다 · 하루 평균 {formatUsd(b.perDayMicros)} 쓰고 있다
        </p>
      )}
    </>
  )
}

export default async function UsagePage() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const u = await loadUsageReport(db, systemClock)
  const maxRoute = Math.max(0, ...u.routes.map((r) => r.costMicros))
  const maxDay = Math.max(0, ...u.days.map((d) => d.costMicros))

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-5 pt-14 pb-16 sm:px-8 sm:pt-24 sm:pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {u.month.replace('-', ' · ')}
          </div>

          <h1 className="mt-6 font-serif text-[34px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">
            얼마 썼나
          </h1>

          <p className="mx-auto mt-5 max-w-[420px] text-balance text-[13.5px] leading-[1.8] text-muted">
            AI 호출은 한 번마다 돈이다. 새는 곳이 보이지 않으면 방어선이 있어도 소용이 없다.
          </p>
        </div>

        <Money u={u} />

        {u.totalCalls === 0 ? (
          <p className="mt-12 text-balance text-center text-[13px] leading-[1.9] text-faint">
            아직 한 번도 호출하지 않았다. 오늘의 학습을 시작하면 여기에 기록이 쌓인다.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            <Panel title="어디에 썼나">
              <ul className="flex flex-col gap-4">
                {u.routes.map((r) => <RouteRow key={r.route} r={r} max={maxRoute} />)}
              </ul>
            </Panel>

            {/* ★ 멱등성 ②겹이 실제로 막은 돈. 설계가 일하고 있다는 증거다 */}
            {u.reuse.reuses > 0 && (
              <Panel
                title="다시 써서 아낀 것"
                note="자료는 Topic 마다 한 번만 만든다. 같은 자료를 다시 여는 것은 공짜다."
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="font-serif text-[34px] leading-none tracking-[-0.03em] text-ok">
                    {formatUsd(u.reuse.savedMicros)}
                  </span>
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">
                    자료 {u.reuse.materials}개를 {u.reuse.uses}번 썼다 ·
                    그중 {u.reuse.reuses}번은 만들지 않았다
                  </span>
                  {/* 정확한 금액이 아니라 규모다. 그렇게 말한다. */}
                  <span className="text-[11.5px] leading-[1.7] text-ghost">
                    평균 생성비로 환산한 추정치다
                  </span>
                </div>
              </Panel>
            )}

            <Panel title="날짜별">
              <ul className="flex flex-col gap-3.5">
                {u.days.map((d) => <DayRow key={d.date} d={d} max={maxDay} />)}
              </ul>
            </Panel>

            <Panel
              title="최근 호출"
              note={
                u.failedCalls > 0
                  ? `실패한 호출이 ${u.failedCalls}번 있었다. 응답을 받고 실패한 것은 돈이 나갔다.`
                  : undefined
              }
            >
              <ul className="flex flex-col gap-2.5">
                {u.recent.map((r, i) => (
                  <CallRow key={`${r.createdAt.toISOString()}-${i}`} r={r} />
                ))}
              </ul>
            </Panel>
          </div>
        )}

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href="/dashboard"
            className="text-[12.5px] text-muted underline underline-offset-4 hover:text-body"
          >
            대시보드로
          </Link>
          {/*
            화면 밖의 방어선. 코드가 못 막는 마지막 한 겹이 어디 있는지
            여기 적어둔다 — 나중의 내가 이 화면만 보고 안심하지 않도록.
          */}
          <span className="max-w-[400px] text-balance text-center text-[11.5px] leading-[1.8] text-ghost">
            이 숫자는 앱이 센 것이다. 마지막 방어선은 OpenAI 대시보드의 하드 리밋이고,
            자동 충전은 꺼져 있어야 한다.
          </span>
        </div>
      </main>
    </>
  )
}
