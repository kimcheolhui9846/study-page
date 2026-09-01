import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { SUBJECTS, getDay, loadCurriculum, type Subject } from '@/lib/curriculum/load'
import { loadProgress } from '@/lib/study/progress'
import { attempts, studyDays } from '@/lib/db/schema'
import { SessionBar } from '@/components/SessionBar'
import { Passage } from '@/components/Passage'
import { AnswerForm } from '@/components/AnswerForm'
import { GradeResult } from '@/components/GradeResult'

export const dynamic = 'force-dynamic'

/** attempts 의 CHECK 제약과 같은 값. 화면은 표시만 하고 강제는 DB 가 한다. */
const ATTEMPT_CAP = 2

export default async function StudyPage({ params }: PageProps<'/study/[subject]'>) {
  // Next 16 에서 params 는 Promise 다.
  const { subject } = await params
  if (!(SUBJECTS as readonly string[]).includes(subject)) notFound()

  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const progress = (await loadProgress(db, systemClock)).find((p) => p.subject === subject)!
  const entry = getDay(subject as Subject, progress.dayNo)
  if (!entry) redirect('/') // 커리큘럼 완주

  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, progress.dayNo)))
  // 아직 콘텐츠가 없으면 대시보드로. 생성 버튼은 Task 11 에서 붙인다.
  if (!day) redirect('/')

  const tries = await db.select().from(attempts).where(eq(attempts.studyDayId, day.id))
  const graded = tries
    .filter((t) => t.feedback !== null)
    .sort((a, b) => b.attemptNo - a.attemptNo)[0]

  const content = day.content as {
    passage: { title: string; body_md: string; key_terms: Array<{ term: string; definition: string }> }
    questions: Array<{ id: string; type: string; prompt: string }>
  }
  const label = loadCurriculum(subject as Subject).label

  return (
    <>
      <SessionBar
        label={`${label} · DAY ${progress.dayNo}`}
        expiringNote="쓰던 답은 브라우저에 남는다. 다시 들어오면 이어서 쓸 수 있다."
      />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-8 pt-20 pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {label} · DAY {progress.dayNo}
          </div>

          <h1 className="mt-6 text-balance font-serif text-[44px] leading-[1.15] tracking-[-0.03em] text-ink">
            {entry.topic}
          </h1>

          <p className="mx-auto mt-5 max-w-[460px] text-balance text-[13.5px] leading-[1.8] text-muted">
            {entry.goal}
          </p>
        </div>

        <Passage
          title={content.passage.title}
          bodyMd={content.passage.body_md}
          keyTerms={content.passage.key_terms}
        />

        {graded ? (
          <GradeResult
            subject={subject}
            dayNo={progress.dayNo}
            attemptNo={graded.attemptNo}
            attemptsLeft={ATTEMPT_CAP - tries.length}
            questions={content.questions}
            answers={graded.answers as Record<string, string>}
            feedback={graded.feedback as never}
          />
        ) : (
          <AnswerForm
            subject={subject}
            dayNo={progress.dayNo}
            questions={content.questions}
            attemptsLeft={ATTEMPT_CAP - tries.length}
          />
        )}
      </main>
    </>
  )
}
