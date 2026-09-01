import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { overview } from '@/lib/curriculum/overview'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'
import type { TopicNode } from '@/lib/curriculum/graph'
import { loadSettings } from '@/lib/settings/store'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

const REQUIRED_STYLE = {
  core: { label: '핵심', className: 'text-ok' },
  recommended: { label: '권장', className: 'text-warn' },
  optional: { label: '보충', className: 'text-faint' },
} as const

function TopicRow({ t, graph }: { t: TopicNode; graph: ReturnType<typeof loadGraph> }) {
  const req = REQUIRED_STYLE[t.required]
  const blocks = graph.dependents.get(t.id)?.length ?? 0

  return (
    <li className="flex flex-col gap-2 border-t border-rule-soft py-5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-4">
        <Link
          href={`/topic/${encodeURIComponent(t.id)}`}
          className="text-balance text-[15.5px] leading-snug text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule-strong"
        >
          {t.title}
        </Link>
        <span className={`shrink-0 font-mono text-[10.5px] tracking-[0.18em] ${req.className}`}>
          {req.label}
        </span>
      </div>

      <p className="text-pretty text-[12.5px] leading-[1.75] text-muted">{t.goal}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-faint">
        <span>난이도 {'●'.repeat(t.difficulty)}{'○'.repeat(5 - t.difficulty)}</span>
        <span>{t.estimatedMinutes}분</span>
        {blocks > 0 && <span>{blocks}개를 연다</span>}
      </div>

      {t.prerequisites.length > 0 && (
        <p className="text-[11.5px] leading-[1.7] text-faint">
          먼저:{' '}
          {t.prerequisites.map((p, i) => {
            const pre = graph.topics.get(p)!
            const crossing = pre.subject !== t.subject
            return (
              <span key={p}>
                {i > 0 && ' · '}
                {/* 과목을 넘는 선수는 눈에 띄어야 한다. 진도가 왜 막혔는지의 답이다. */}
                <span className={crossing ? 'text-warn' : 'text-muted'}>
                  {crossing ? `${pre.subject} · ` : ''}
                  {pre.title}
                </span>
              </span>
            )
          })}
        </p>
      )}
    </li>
  )
}

export default async function CurriculumPage({
  searchParams,
}: PageProps<'/curriculum'>) {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  // Next 16 에서 searchParams 는 Promise 다.
  const params = await searchParams
  const raw = typeof params.subject === 'string' ? params.subject : null
  const active = (SUBJECTS as readonly string[]).includes(raw ?? '')
    ? (raw as Subject)
    : null

  const graph = loadGraph()
  // 목표 기간을 화면마다 다르게 박아두면 대시보드와 어긋난다. 설정이 진실이다.
  const { targetDayCount } = await loadSettings(db)
  const all = overview(graph, targetDayCount)
  const shown = active ? all.filter((s) => s.subject === active) : all
  const totalTopics = all.reduce((n, s) => n + s.topicCount, 0)

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            주제 {totalTopics}개
          </div>

          <h1 className="mt-6 font-serif text-[34px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">
            커리큘럼
          </h1>

          <p className="mx-auto mt-5 max-w-[460px] text-balance text-[13.5px] leading-[1.8] text-muted">
            순서가 아니라 관계다. 먼저 알아야 하는 것이 있으면 그것부터 열린다.
          </p>
        </div>

        <nav className="mt-10 flex justify-center gap-2">
          <Link
            href="/curriculum"
            className={`h-9 rounded-control px-4 text-[12.5px] leading-9 transition-colors ${
              active === null
                ? 'bg-ink text-paper'
                : 'text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] hover:text-body'
            }`}
          >
            전체
          </Link>
          {all.map((s) => (
            <Link
              key={s.subject}
              href={`/curriculum?subject=${s.subject}`}
              className={`h-9 rounded-control px-4 text-[12.5px] leading-9 transition-colors ${
                active === s.subject
                  ? 'bg-ink text-paper'
                  : 'text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] hover:text-body'
              }`}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="mt-14 flex flex-col gap-14">
          {shown.map((s) => (
            <section key={s.subject}>
              <h2 className="text-center font-serif text-[30px] tracking-[-0.02em] text-ink">
                {s.label}
              </h2>
              <p className="mt-2 text-center font-mono text-[10.5px] tracking-[0.22em] text-faint">
                {s.topicCount}개 주제
              </p>

              <div className="mt-8 flex flex-col gap-10">
                {s.domains.map((d) => (
                  <div key={d.domain}>
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="font-serif text-[19px] text-ink">{d.label}</h3>
                      <span className="font-mono text-[10.5px] tracking-[0.18em] text-faint">
                        {d.topics.length}개
                      </span>
                    </div>

                    <ul className="mt-4 rounded-card bg-surface px-6 py-1 shadow-[inset_0_0_0_1px_var(--color-rule)]">
                      {d.topics.map((t) => (
                        <TopicRow key={t.id} t={t} graph={graph} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  )
}
