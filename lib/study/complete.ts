import { and, eq, isNull, sql } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import type { Subject } from '../curriculum/load'

/**
 * Day 를 마친다.
 *
 * `gradingDisputed` 는 「이 채점이 틀렸다」다 (스펙 §5.8). **LLM 을 다시
 * 부르지 않고 플래그만 남긴다** — 모델이 루브릭을 틀리게 만들었을 때
 * 사용자가 그 Day 에 갇히지 않게 하는 탈출구이고 비용은 0원이다.
 * 나중에 이 기록을 보고 커리큘럼을 고친다.
 *
 * `||` 로 병합하므로 기존 content(지문·문제·루브릭)를 지우지 않는다.
 *
 * `completedAt` 이 이미 있으면 건드리지 않는다 — 새로고침으로 두 번
 * 눌릴 수 있고, 그때 완료 시각이 밀리면 "언제 마쳤나"가 거짓말이 된다.
 */
export async function completeDay(
  db: Db, clock: Clock, subject: Subject, dayNo: number, gradingDisputed: boolean,
): Promise<void> {
  await db.update(studyDays)
    .set({
      status: 'completed',
      completedAt: clock.now(),
      ...(gradingDisputed
        ? { content: sql`${studyDays.content} || '{"grading_disputed":true}'::jsonb` }
        : {}),
    })
    .where(and(
      eq(studyDays.subject, subject),
      eq(studyDays.dayNo, dayNo),
      isNull(studyDays.completedAt), // 이미 마쳤으면 건드리지 않는다
    ))
}
