import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { topicProgress } from '@/lib/db/schema'
import { kstToday, systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadGraph } from '@/lib/curriculum/load'
import { subjectLabel } from '@/lib/curriculum/overview'
import { readPlan } from '@/lib/plan/store'
import { loadUsage } from '@/lib/budget/usage'
import { loadStoredMaterial } from '@/lib/llm/ensure'
import { GradedTopicSchema, publicQuestions, solutionsOf } from '@/lib/llm/schemas'
import { SessionBar } from '@/components/SessionBar'
import { StartTopic } from '@/components/StartTopic'
import { Passage } from '@/components/Passage'
import { AnswerForm } from '@/components/AnswerForm'
import { GradeResult } from '@/components/GradeResult'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  new: '새로 배운다', review: '복습', remediation: '보충',
}

/**
 * Topic 하나를 학습하는 화면.
 *
 * ★ 이 페이지는 LLM 을 부르지 않는다. 저장된 자료를 읽기만 한다.
 * 생성은 「자료 만들기」 버튼이 POST 로 한다 — GET 렌더에서 돈이 나가면
 * 새로고침과 프리페치가 곧 비용이 된다.
 */
export default async function TopicPage(
  { params }: { params: Promise<{ topicId: string }> },
) {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const { topicId: raw } = await params
  const topicId = decodeURIComponent(raw)

  const graph = loadGraph()
  const topic = graph.topics.get(topicId)
  const plan = await readPlan(db, kstToday(systemClock.now()))
  const item = plan?.items.find((i) => i.topicId === topicId)
  if (!topic || !plan || !item) notFound()

  const material = await loadStoredMaterial(db, topic, {
    topicId, kind: item.kind as 'new' | 'review' | 'remediation',
    round: item.round, minutes: item.minutes,
  })

  const usage = await loadUsage(db, systemClock)
  const callsLeft = Math.max(0, usage.dailyCap - usage.dailyCalls)

  const [progress] = await db.select().from(topicProgress)
    .where(eq(topicProgress.topicId, topicId))

  // 채점 결과는 zod 로 다시 읽는다. 스키마가 바뀌면 조용히 깨진 화면을
  // 그리는 대신 결과를 안 보여준다.
  const graded = item.feedback ? GradedTopicSchema.safeParse(item.feedback) : null

  return (
    <>
      <SessionBar label={`DAY ${plan.dayNumber}`} />

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-20">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.22em] text-faint">
            {subjectLabel(graph, topic.subject)} · {topic.domainLabel}
          </div>

          <Link
            href={`/topic/${encodeURIComponent(topicId)}`}
            className="mt-6 block text-balance font-serif text-[32px] leading-[1.15] tracking-[-0.03em] text-ink underline decoration-transparent underline-offset-8 transition-colors hover:decoration-rule-strong sm:text-[42px]"
          >
            {topic.title}
          </Link>

          <p className="mx-auto mt-5 max-w-[440px] text-balance text-[13.5px] leading-[1.8] text-muted">
            {topic.goal}
          </p>

          <div className="mt-6 flex items-center justify-center gap-2.5">
            <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint">
              {KIND_LABEL[item.kind] ?? item.kind}
              {item.round !== null && ` ${item.round}회차`}
            </span>
            <span className="font-mono text-[10.5px] tracking-[0.18em] text-ghost">
              {item.minutes}분 · 난이도 {topic.difficulty}
            </span>
          </div>
        </div>

        {material === 'invalid' ? (
          <p className="mt-14 text-center text-balance text-[13.5px] leading-[1.8] text-stop">
            저장된 자료를 지금 형식으로 읽을 수 없다. 다시 만들지 않는다 — 이건 사람이 볼 일이다.
          </p>
        ) : !material ? (
          <StartTopic
            topicId={topicId}
            kind={item.kind as 'new' | 'review' | 'remediation'}
            round={item.round}
            callsLeft={callsLeft}
          />
        ) : graded?.success ? (
          <GradeResult
            questions={publicQuestions(material)}
            solutions={solutionsOf(material)}
            answers={item.answers ?? {}}
            feedback={graded.data}
            masteryScore={progress?.masteryScore ?? item.score ?? 0}
            nextReviewAt={progress?.nextReviewAt ?? null}
          />
        ) : (
          <>
            <Passage
              title={material.title}
              bodyMd={material.bodyMd}
              keyTerms={material.keyTerms}
            />
            <AnswerForm
              topicId={topicId}
              questions={publicQuestions(material)}
              saved={item.answers}
            />
          </>
        )}

        <div className="grow" />

        <div className="mx-auto mt-16 h-px w-16 bg-rule" />

        <div className="mt-6 flex justify-center">
          <Link
            href="/today"
            className="text-[12.5px] text-muted underline underline-offset-4 hover:text-body"
          >
            오늘의 학습으로
          </Link>
        </div>
      </main>
    </>
  )
}
