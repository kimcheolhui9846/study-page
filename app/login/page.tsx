import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { db } from '@/lib/db/client'
import { kstDateLabel, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { LoginForm } from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  // 이미 세션이 있으면 로그인 화면을 보여줄 이유가 없다.
  const token = (await cookies()).get('sid')?.value
  if (token) {
    const session = await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    if (session) redirect('/')
  }

  // 날짜는 서버에서 만든다. 클라이언트의 시간대를 따라가면 서버가 판정하는
  // '오늘'과 어긋난다.
  const dateLabel = kstDateLabel(systemClock.now())

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-[400px] flex-col">
        <div className="font-mono text-xs tracking-[0.14em] text-faint">{dateLabel}</div>

        <h1 className="mt-[18px] font-serif text-[42px] leading-tight tracking-tight text-ink">
          오늘의 공부
        </h1>

        <p className="mt-3 text-[15px] leading-[1.7] text-muted">영어 · 수학 · CS — 하루 한 번.</p>

        <LoginForm />

        <div className="mt-11 h-px bg-rule" />

        <div className="mt-[22px] flex flex-col gap-2.5">
          <p className="text-[13px] leading-[1.75] text-muted">
            15분 동안 아무것도 하지 않으면 세션이 스스로 닫힌다.
          </p>
          <p className="text-[13px] leading-[1.75] text-muted">
            <span className="text-body">[종료]</span>를 누르면 그 즉시 서버에서 지워지고, 창을
            닫으면 30초 뒤에 지워진다. 세션이 없는 동안에는 어떤 AI 호출도 일어나지 않는다.
          </p>
        </div>
      </div>
    </main>
  )
}
