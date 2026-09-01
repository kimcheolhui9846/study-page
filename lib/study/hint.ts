import { and, eq } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Subject } from '../curriculum/load'

/**
 * 힌트를 DB 에서 꺼낸다. **LLM 을 부르지 않는다.**
 *
 * 힌트는 콘텐츠 생성 때 이미 만들어져 저장돼 있다 (스펙 §5.4).
 * 여기서 모델을 부르는 순간 이 함수의 존재 이유가 사라진다 — 비용 0원이
 * 전부다.
 *
 * 문제 하나의 hint 만 돌려준다. content 를 통째로 주면 expected_points 가
 * 따라 나간다.
 */
export async function readHint(
  db: Db, subject: Subject, dayNo: number, questionId: string,
): Promise<string | null> {
  const [day] = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, dayNo)))
  if (!day) return null

  const questions = (day.content as { questions?: Array<{ id: string; hint?: string }> }).questions
  return questions?.find((q) => q.id === questionId)?.hint ?? null
}
