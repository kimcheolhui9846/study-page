import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { subjectLabel } from '@/lib/curriculum/overview'
import { ensureTodayPlan, type StoredPlan } from '@/lib/plan/store'
import { loadSettings } from '@/lib/settings/store'
import { loadUsage } from '@/lib/budget/usage'
import { loadMaterialKeys, materialKey } from '@/lib/llm/ensure'
import { SessionBar } from '@/components/SessionBar'
import { GradePlan } from '@/components/GradePlan'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, { label: string; className: string }> = {
  new: { label: '새로 배운다', className: 'text-ok' },
  review: { label: '복습', className: 'text-warn' },
  remediation: { label: '보충', className: 'text-stop' },
}

type Item = StoredPlan['items'][number]

/**
 * 항목이 지금 어디까지 왔는가. 화면의 한 줄이 이 판정에서 나온다.
 *
 * ★ 자료 유무는 항목의 status 가 아니라 실제 저장 여부로 본다.
 * 어제 만들어둔 Topic 이 오늘 다시 뽑히면 항목은 pending 이지만 자료는 있다 —
 * status 로 판단하면 화면이 "자료 없음"이라고 거짓말하고, 사용자는 쓰지도
 * 않을 AI 호출을 각오하게 된다.
 */
function stageOf(item: Item, hasMaterial: boolean): { label: string; className: string } {
  if (item.status === 'done') return { label: `${item.score}점 · 채점됨`, className: 'text-ok' }
  if (item.answers) return { label: '답 씀 · 채점 대기', className: 'text-warn' }
  if (hasMaterial) return { label: '자료 있음 · 답 쓰기', className: 'text-muted' }
  return { label: '자료 없음', className: 'text-faint' }
}

function ItemCard(
  { item, graph, hasMaterial }:
  { item: Item; graph: ReturnType<typeof loadGraph>; hasMaterial: boolean },
) {
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

  const stage = stageOf(item, hasMaterial)

  return (
    <li>
      <Link
        href={`/today/${encodeURIComponent(item.topicId)}`}
        className={`flex flex-col items-center rounded-card px-5 pt-6 pb-5 text-center transition-shadow sm:px-7 sm:pt-7 sm:pb-6 ${
          done ? 'bg-note' : 'bg-surface'
        } shadow-[inset_0_0_0_1px_var(--color-rule)] hover:shadow-[inset_0_0_0_1.5px_var(--color-rule-strong)]`}
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

        <span className={`mt-5 font-mono text-[10.5px] tracking-[0.18em] ${stage.className}`}>
          {stage.label}
        </span>
      </Link>
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
  const materials = await loadMaterialKeys(db)
  const hasMaterial = (i: StoredPlan['items'][number]) =>
    materials.has(materialKey(i.topicId, i.kind, i.round))

  const done = plan.items.filter((i) => i.status === 'done').length
  const allDone = plan.items.length > 0 && done === plan.items.length
  // 답을 다 쓴 항목. 이만큼이 호출 1회로 채점된다.
  const ready = plan.items.filter((i) => i.status === 'studying' && i.answers).length
  // 남은 것이 하나라도 있으면 채점을 미룬다 — 채점은 하루에 한 번이다.
  const waiting = plan.items.filter((i) => i.status !== 'done' && !i.answers).length
  // 아직 자료를 안 만든 항목. 여기에 오늘 쓸 호출이 남아 있다.
  const toGenerate = plan.items.filter((i) => i.status !== 'done' && !hasMaterial(i)).length

  return (
    <>
      <SessionBar label={`DAY ${plan.dayNumber}`} />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {kstDateLabel(systemClock.now())} · DAY {plan.dayNumber}
          </div>

          <h1 className="mt-6 font-serif text-[38px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[48px]">
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
                <ItemCard
                  key={item.id}
                  item={item}
                  graph={graph}
                  hasMaterial={hasMaterial(item)}
                />
              ))}
            </ul>
          </>
        )}

        {ready > 0 && waiting === 0 && <GradePlan ready={ready} callsLeft={callsLeft} />}

        {ready > 0 && waiting > 0 && (
          <p className="mt-12 text-center text-balance text-[13px] leading-[1.8] text-muted">
            {waiting}개가 남았다. 오늘 것을 다 쓰면 한 번에 채점한다 — AI 호출 1회다.
          </p>
        )}

        {allDone && (
          <p className="mt-12 text-center text-balance text-[14px] leading-[1.8] text-ok">
            오늘을 마쳤다. 내일 계획은 오늘 결과를 반영해 달라진다.
          </p>
        )}

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex flex-col items-center gap-3">
          {/*
            계획이 세워질 때의 예상(estimatedCalls)이 아니라 **지금부터** 쓸
            호출 수를 적는다. 이미 만들어둔 자료는 다시 만들지 않으므로,
            어제 남긴 Topic 이 오늘 다시 뽑히면 이 숫자가 예상보다 작다.
          */}
          <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
            앞으로 쓸 AI 호출 {toGenerate + (plan.items.length > done ? 1 : 0)} · 오늘 남은 {callsLeft}
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
