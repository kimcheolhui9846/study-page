import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { kstDateLabel, kstTimeLabel, kstToday, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { MODES, STUDY_MODES } from '@/lib/study/modes'
import { listRecentSessions } from '@/lib/study/store'
import { SessionBar } from '@/components/SessionBar'
import { ModePicker, type ModeCard } from '@/components/study/ModePicker'
import { MODE_STYLE } from '@/components/study/modeStyle'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/curriculum', label: '커리큘럼' },
  { href: '/today', label: '오늘의 계획' },
  { href: '/admin/usage', label: '비용' },
]

/**
 * 홈 — 모드를 고르고 바로 공부한다.
 *
 * 기존 커리큘럼·오늘 계획은 보조 메뉴로 남는다. 새 학습의 진입 조건이 아니다.
 * 이 화면은 DB 를 읽기만 한다 — AI 호출은 「학습 시작」 POST 에서만 일어난다.
 */
export default async function Home() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const now = systemClock.now()
  const recent = await listRecentSessions(db)
  const modes: ModeCard[] = STUDY_MODES.map((id) => ({
    id, label: MODES[id].label, blurb: MODES[id].blurb, examples: MODES[id].examples,
  }))

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-5 pt-14 pb-14 sm:px-8 sm:pt-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">{kstDateLabel(now)}</div>
          <h1 className="mt-6 font-serif text-[44px] leading-[1.08] tracking-[-0.035em] text-ink sm:text-[64px]">
            오늘은 무엇을<br className="sm:hidden" /> 공부할까
          </h1>
          <p className="mx-auto mt-5 max-w-[480px] text-balance text-[14.5px] leading-[1.85] text-muted">
            과목을 고르고, 궁금한 것을 그대로 적는다. 자료와 문제가 나오고 — 같은 자리에서 묻고, 풀고, 고친다.
          </p>
        </div>

        <ModePicker modes={modes} />

        <section className="mt-14">
          <div className="flex items-center gap-4">
            <h2 className="font-mono text-[10px] tracking-[0.24em] text-faint">이어서 공부하기</h2>
            <span className="h-px grow bg-rule" />
          </div>
          {recent.length === 0 ? (
            <p className="mt-5 text-center text-[13px] text-muted">아직 시작한 학습이 없다.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
              {recent.map((s) => {
                const day = kstToday(s.updatedAt)
                return (
                  <li key={s.id} className="border-b border-rule-soft">
                    <Link href={`/study/${s.id}`} className="group flex items-center gap-3.5 py-3.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control font-serif text-[15px] ${MODE_STYLE[s.mode].tint} ${MODE_STYLE[s.mode].text}`}>
                        {MODE_STYLE[s.mode].glyph}
                      </span>
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[14.5px] text-body transition-colors group-hover:text-ink">{s.title}</span>
                        <span className="font-mono text-[10px] tracking-[0.16em] text-faint">{MODES[s.mode].label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ghost">
                        {day === kstToday(now) ? kstTimeLabel(s.updatedAt) : day.slice(5).replace('-', '.')}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="grow" />
        <div className="mx-auto mt-16 h-px w-16 bg-rule" />
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="font-mono text-[10.5px] tracking-[0.22em] text-faint underline decoration-rule underline-offset-[6px] transition-colors hover:text-muted"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </main>
    </>
  )
}
