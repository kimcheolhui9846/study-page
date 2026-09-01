import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { subjectLabel } from '@/lib/curriculum/overview'
import { ensureTodayPlan, loadSettings, type StoredPlan } from '@/lib/plan/store'
import { loadUsage } from '@/lib/budget/usage'
import { SessionBar } from '@/components/SessionBar'
import { ScoreEntry } from '@/components/ScoreEntry'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, { label: string; className: string }> = {
  new: { label: '새로 배운다', className: 'text-ok' },
  review: { label: '복습', className: 'text-warn' },
  remediation: { label: '보충', className: 'text-stop' },
}

function Item({
  item, planId, graph,
}: {
  item: StoredPlan['items'][number]
  planId: number
  graph: ReturnType<typeof loadGraph>
}) {
  const topic = graph.topics.get(item.topicId)
  const kind = KIND_LABEL[item.kind] ?? { label: item.kind, className: 'text-muted' }
  const done = item.status === 'done'

  // 커리큘럼에서 사라진 Topic 이 옛 계획에 남아 있을 수 있다. 화면이 죽지 않게.
  if (!topic) {
    return (
      <li className="rounded-card bg-surface px-7 py-6 text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
        <p className="text-[13px] text-faint">
          커리큘럼에서 사라진 주제다 ({item.topicId})
        </p>
      </li>
    )
  }

  return (
    <li
      className={`flex flex-col items-center rounded-card px-7 pt-7 pb-6 text-center transition-opacity ${
        done ? 'bg-note opacity-60' : 'bg-surface'
      } shadow-[inset_0_0_0_1px_var(--color-rule)]`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`font-mono text-[10.5px] tracking-[0.22em] ${kind.className}`}>
          {kind.label}
          {item.round !== null && ` ${item.round}회차`}
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.18em] text-faint">
          {subjectLabel(graph, topic.subject)} · {item.minutes}분
        </span>
      </div>

      <h3 className="mt-3 text-balance font-serif text-[24px] leading-snug tracking-[-0.02em] text-ink">
        {topic.title}
      </h3>

      <p className="mt-3 max-w-[420px] text-balance text-[13px] leading-[1.8] text-muted">
        {topic.goal}
      </p>

      {done ? (
        <p className="mt-5 font-mono text-[11px] tracking-[0.18em] text-ok">
          {item.score}점 · 마쳤다
        </p>
      ) : (
        <ScoreEntry topicId={item.topicId} planId={planId} />
      )}
    </li>
  )
}

export default async function TodayPage() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const usage = await loadUsage(db, systemClock)
  const callsLeft = Math.max(0, usage.dailyCap - usage.dailyCalls)

  const plan = await ensureTodayPlan(db, systemClock, callsLeft)
  const settings = await loadSettings(db)
  const graph = loadGraph()

  const done = plan.items.filter((i) => i.status === 'done').length
  const allDone = plan.items.length > 0 && done === plan.items.length

  return (
    <>
      <SessionBar label={`DAY ${plan.dayNumber}`} />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-8 pt-20 pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {kstDateLabel(systemClock.now())} · DAY {plan.dayNumber}
          </div>

          <h1 className="mt-6 font-serif text-[48px] leading-[1.1] tracking-[-0.03em] text-ink">
            오늘의 학습
          </h1>

          <p className="mx-auto mt-5 max-w-[440px] text-balance text-[13.5px] leading-[1.8] text-muted">
            {plan.items.length === 0
              ? '오늘 할 수 있는 것이 없다. 남은 AI 호출이 없거나 커리큘럼을 다 마쳤다.'
              : `${plan.items.length}개 · ${plan.estimatedMinutes}분 · 하루 목표 ${settings.dailyStudyMinutes}분`}
          </p>
        </div>

        {plan.items.length > 0 && (
          <>
            <div className="mx-auto mt-8 flex items-center gap-3">
              <div className="h-[2px] w-40 rounded-sm bg-rule-soft">
                <div
                  className="h-[2px] rounded-sm bg-ok transition-[width]"
                  style={{ width: `${Math.round((done / plan.items.length) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[10.5px] tracking-[0.18em] text-faint">
                {done} / {plan.items.length}
              </span>
            </div>

            <ul className="mt-12 flex flex-col gap-5">
              {plan.items.map((item) => (
                <Item key={item.id} item={item} planId={plan.id} graph={graph} />
              ))}
            </ul>
          </>
        )}

        {allDone && (
          <p className="mt-10 text-center text-balance text-[14px] leading-[1.8] text-ok">
            오늘을 마쳤다. 내일 계획은 오늘 결과를 반영해 달라진다.
          </p>
        )}

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
            오늘 예상 AI 호출 {plan.estimatedCalls} · 남은 호출 {callsLeft}
          </span>
          <Link
            href="/"
            className="text-[12.5px] text-muted underline underline-offset-4 hover:text-body"
          >
            대시보드로
          </Link>
        </div>
      </main>
    </>
  )
}
