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
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      {/* text-center 로 글자만 모은다. items-center 를 쓰면 입력란과 버튼이
          내용 너비로 쪼그라든다. */}
      <div className="flex w-[380px] flex-col text-center">
        <div className="font-mono text-[11px] tracking-[0.22em] text-faint">{dateLabel}</div>

        <h1 className="mt-6 font-serif text-[52px] leading-[1.1] tracking-[-0.03em] text-ink">
          오늘의 공부
        </h1>

        <p className="mt-5 text-[14px] leading-[1.7] tracking-[0.01em] text-muted">
          영어 · 수학 · CS
        </p>

        <LoginForm />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        {/* 가운데 정렬에서는 고아 줄이 특히 눈에 띈다.
            각 줄이 한 줄에 들어가도록 문구를 짧게 유지한다. */}
        <div className="mt-7 flex flex-col gap-2">
          <p className="text-[12.5px] leading-[1.9] text-faint">
            15분 동안 아무것도 하지 않으면 세션이 닫힌다.
          </p>
          <p className="text-[12.5px] leading-[1.9] text-faint">
            <span className="text-muted">[종료]</span>는 즉시, 창을 닫으면 30초 뒤에 지워진다.
          </p>
          <p className="text-[12.5px] leading-[1.9] text-faint">
            세션이 없는 동안 AI 호출은 일어나지 않는다.
          </p>
        </div>
      </div>
    </main>
  )
}
