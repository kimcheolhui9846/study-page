import { and, eq, isNotNull, desc } from 'drizzle-orm'
import { dailyPlans, planItems } from '../db/schema'
import type { Db } from '../db/types'
import { kstToday, type Clock } from '../time'
import { loadGraph } from '../curriculum/load'
import { loadProgressMap, loadSettings } from '../plan/store'
import {
  paceOf, recentScores, reviewLoad, streakDays, subjectProgress,
  type Pace, type RecentScore, type SubjectProgress,
} from './summary'

/**
 * 대시보드가 필요한 것을 한 번에 읽는다.
 *
 * 계산은 전부 `summary.ts` 의 순수 함수가 한다. 여기는 DB 에서 값을
 * 꺼내 넘기기만 한다 — 그래서 숫자의 정의를 테스트로 지킬 수 있다.
 */

export interface Dashboard {
  subjects: SubjectProgress[]
  streak: number
  pace: Pace
  recent: RecentScore[]
  reviews: { due: number; upcoming: number }
  /** 목표 기간. 페이스와 견주는 기준이다 */
  targetDayCount: number
  dailyStudyMinutes: number
  today: string
}

export async function loadDashboard(db: Db, clock: Clock): Promise<Dashboard> {
  const today = kstToday(clock.now())
  const graph = loadGraph()
  const settings = await loadSettings(db)
  const progress = await loadProgressMap(db)

  // 채점까지 끝난 항목만. 계획만 세워두고 안 한 날은 공부한 날이 아니다.
  const done = await db
    .select({
      topicId: planItems.topicId,
      score: planItems.score,
      studyDate: dailyPlans.studyDate,
    })
    .from(planItems)
    .innerJoin(dailyPlans, eq(dailyPlans.id, planItems.planId))
    .where(and(eq(planItems.status, 'done'), isNotNull(planItems.score)))
    .orderBy(desc(dailyPlans.studyDate))

  const graded = done.map((r) => ({
    topicId: r.topicId,
    score: r.score!,
    studyDate: r.studyDate,
  }))

  const subjects = subjectProgress(graph, settings.targetDayCount, progress)
  const activeDays = new Set(graded.map((g) => g.studyDate))

  return {
    subjects,
    streak: streakDays(activeDays, today),
    pace: paceOf({
      activeDays: activeDays.size,
      masteredTopics: subjects.reduce((n, s) => n + s.mastered, 0),
      totalTopics: subjects.reduce((n, s) => n + s.total, 0),
      today,
    }),
    recent: recentScores(graph, graded),
    reviews: reviewLoad(progress, today),
    targetDayCount: settings.targetDayCount,
    dailyStudyMinutes: settings.dailyStudyMinutes,
    today,
  }
}
