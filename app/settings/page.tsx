import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { topicsFor } from '@/lib/curriculum/graph'
import { loadSettings, TARGET_DAYS_MAX } from '@/lib/settings/store'
import { SessionBar } from '@/components/SessionBar'
import { SettingsForm } from '@/components/SettingsForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const settings = await loadSettings(db)

  /*
   * 총 분량은 **가장 넓은 범위**로 잰다.
   *
   * 목표 기간이 담을 수준을 정하므로(30일=core, 60일=+권장, 그 이상=전부),
   * 지금 설정 기준으로 재면 목표를 늘릴 때 총량이 같이 늘어 화면이 요동친다.
   * 화면에서 슬라이더를 움직이며 견주려면 분모가 고정돼 있어야 한다.
   */
  const totalMinutes = topicsFor(loadGraph(), TARGET_DAYS_MAX)
    .reduce((n, t) => n + t.estimatedMinutes, 0)

  return (
    <>
      <SessionBar />

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5 pt-14 pb-16 sm:px-8 sm:pt-24 sm:pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">설정</div>

          <h1 className="mt-6 font-serif text-[34px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">
            어떻게 공부할까
          </h1>

          <p className="mx-auto mt-5 max-w-[400px] text-balance text-[13.5px] leading-[1.8] text-muted">
            여기서 바꾼 값이 내일 계획을 바꾼다.
          </p>
        </div>

        <SettingsForm initial={settings} totalMinutes={totalMinutes} />

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex justify-center">
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
