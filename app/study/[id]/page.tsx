import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { MODES } from '@/lib/study/modes'
import { parseId } from '@/lib/study/http'
import { loadSessionView } from '@/lib/study/store'
import { SessionBar } from '@/components/SessionBar'
import { StudyRoom } from '@/components/study/StudyRoom'
import { MODE_STYLE } from '@/components/study/modeStyle'

export const dynamic = 'force-dynamic'

/**
 * 학습 공간. **읽기만 한다** — 새로고침·재접속·프리페치가 AI 를 부르지 않는다.
 * 넘기는 데이터는 공개 뷰다. 미공개 해설·루브릭은 초기 HTML 에 들어가지 않는다.
 */
export default async function StudyPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const id = parseId((await params).id)
  if (!id) notFound()
  const view = await loadSessionView(db, id)
  if (!view) notFound()

  const h = MODES[view.session.mode]
  const st = MODE_STYLE[h.id]

  return (
    <>
      <SessionBar
        label={`${h.label} · 자유학습`}
        expiringNote="쓰던 답과 메시지는 이 브라우저에 남는다."
      />
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pt-8 pb-16 sm:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-card font-serif text-[20px] ${st.tint} ${st.text}`}>
              {st.glyph}
            </span>
            <div className="min-w-0">
              <p className={`font-mono text-[10.5px] tracking-[0.24em] ${st.text}`}>{h.label} · 자유학습</p>
              <h1 className="mt-1 truncate font-serif text-[26px] leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
                {view.session.title}
              </h1>
            </div>
          </div>
          <Link href="/" className="mt-1 shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] transition-colors hover:text-ink">
            ← 새 학습
          </Link>
        </div>

        <StudyRoom
          view={view}
          mode={{ id: h.id, label: h.label, isCoding: h.id === 'coding', defaultFeedbackMode: h.defaultFeedbackMode }}
        />
      </main>
    </>
  )
}
