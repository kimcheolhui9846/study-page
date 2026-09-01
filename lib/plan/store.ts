import { and, eq, sql } from 'drizzle-orm'
import { dailyPlans, planItems, topicProgress, users } from '../db/schema'
import type { Db } from '../db/types'
import { kstToday, type Clock } from '../time'
import { loadGraph } from '../curriculum/load'
import { buildDailyPlan } from './build'
import type { DailyPlan, PlanInput, ProgressState } from './types'
import type { MasteryStatus } from '../mastery/transition'

/**
 * 계획 엔진과 DB 사이. 순수 함수는 lib/plan/build.ts 에 있고
 * 여기는 그것을 읽고 쓰는 일만 한다.
 */

export interface Settings {
  targetDayCount: number
  dailyStudyMinutes: number
}

const DEFAULT_SETTINGS: Settings = { targetDayCount: 90, dailyStudyMinutes: 60 }

/** 설정은 한 행뿐이다. 없으면 기본값으로 만든다. */
export async function loadSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(users).limit(1)
  if (row) {
    return { targetDayCount: row.targetDayCount, dailyStudyMinutes: row.dailyStudyMinutes }
  }
  await db.insert(users).values({}).onConflictDoNothing()
  return DEFAULT_SETTINGS
}

export async function loadProgressMap(db: Db): Promise<Map<string, ProgressState>> {
  const rows = await db.select().from(topicProgress)
  const m = new Map<string, ProgressState>()

  for (const r of rows) {
    m.set(r.topicId, {
      topicId: r.topicId,
      status: r.status as MasteryStatus,
      masteryScore: r.masteryScore,
      wrongCount: r.wrongCount,
      nextReviewAt: r.nextReviewAt,
      reviewRound: r.reviewRound,
      // timestamp 를 KST 날짜 문자열로 좁힌다. 계획 엔진은 날짜만 본다.
      lastStudiedAt: r.lastStudiedAt ? kstToday(r.lastStudiedAt) : null,
      // jsonb 는 타입이 unknown 으로 온다. 모양이 깨졌으면 빈 배열로 떨어뜨린다.
      weakConcepts: Array.isArray(r.weakConcepts) ? (r.weakConcepts as string[]) : [],
    })
  }
  return m
}

/** 다음 Day 번호. 계획이 없으면 1 이다. */
async function nextDayNumber(db: Db): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(${dailyPlans.dayNumber}), 0)` })
    .from(dailyPlans)
  return (row?.max ?? 0) + 1
}

export interface StoredPlan {
  id: number
  dayNumber: number
  studyDate: string
  estimatedCalls: number
  estimatedMinutes: number
  status: string
  items: Array<{
    id: number
    topicId: string
    kind: string
    round: number | null
    minutes: number
    priority: number
    status: string
    score: number | null
    /** 학습자가 쓴 답. 아직 안 썼으면 null */
    answers: Record<string, string> | null
    /** 채점 결과. 아직 안 받았으면 null */
    feedback: unknown | null
  }>
}

export async function readPlan(db: Db, studyDate: string): Promise<StoredPlan | null> {
  const [plan] = await db.select().from(dailyPlans).where(eq(dailyPlans.studyDate, studyDate))
  if (!plan) return null

  const items = await db.select().from(planItems).where(eq(planItems.planId, plan.id))

  return {
    id: plan.id,
    dayNumber: plan.dayNumber,
    studyDate: plan.studyDate,
    estimatedCalls: plan.estimatedCalls,
    estimatedMinutes: plan.estimatedMinutes,
    status: plan.status,
    items: items
      .map((i) => ({
        id: i.id,
        topicId: i.topicId,
        kind: i.kind,
        round: i.round,
        minutes: i.minutes,
        priority: i.priority,
        status: i.status,
        score: i.score,
        answers: (i.answers as Record<string, string> | null) ?? null,
        feedback: i.feedback ?? null,
      }))
      .sort((a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId)),
  }
}

/**
 * 오늘의 계획을 가져온다. 없으면 만들어 저장한다.
 *
 * ★ 하루에 한 번만 만들어진다 — `one_plan_per_date` UNIQUE 가 강제한다.
 * 새로고침으로 두 번 눌려도 두 번째는 조용히 기존 계획을 돌려준다.
 * 계획을 다시 세우면 그날의 학습 순서가 바뀌어버린다.
 */
export async function ensureTodayPlan(
  db: Db, clock: Clock, callsLeft: number,
): Promise<StoredPlan> {
  const now = clock.now()
  const studyDate = kstToday(now)

  const existing = await readPlan(db, studyDate)
  if (existing) return existing

  const settings = await loadSettings(db)
  const input: PlanInput = {
    studyDate,
    dayNumber: await nextDayNumber(db),
    dailyStudyMinutes: settings.dailyStudyMinutes,
    targetDayCount: settings.targetDayCount,
    progress: await loadProgressMap(db),
    callsLeft,
  }

  const plan: DailyPlan = buildDailyPlan(loadGraph(), input, now)

  const [row] = await db.insert(dailyPlans).values({
    dayNumber: plan.dayNumber,
    studyDate: plan.studyDate,
    estimatedCalls: plan.estimatedCalls,
    estimatedMinutes: plan.estimatedMinutes,
  }).onConflictDoNothing().returning({ id: dailyPlans.id })

  // 동시에 두 요청이 들어왔다. 먼저 넣은 쪽의 계획을 쓴다.
  if (!row) return (await readPlan(db, studyDate))!

  if (plan.items.length > 0) {
    await db.insert(planItems).values(plan.items.map((c) => ({
      planId: row.id,
      topicId: c.topicId,
      kind: c.kind,
      round: c.round,
      minutes: c.minutes,
      priority: c.priority,
    })))
  }

  return (await readPlan(db, studyDate))!
}

/**
 * 자료가 만들어졌음을 표시한다. 이미 답을 쓴 항목은 건드리지 않는다.
 *
 * `status` 를 되돌리지 않는 이유: 채점까지 끝난 항목의 자료를 다시 열었을 때
 * 'done' 이 'studying' 으로 내려가면 그날의 진도가 사라진 것처럼 보인다.
 */
export async function markStudying(db: Db, planId: number, topicId: string): Promise<void> {
  await db.update(planItems)
    .set({ status: 'studying' })
    .where(and(
      eq(planItems.planId, planId),
      eq(planItems.topicId, topicId),
      eq(planItems.status, 'pending'),
    ))
}

/**
 * 답안을 저장한다. **LLM 을 부르지 않는다.**
 *
 * 채점은 계획 전체를 모아 한 번에 부르므로, 답을 쓰는 것과 채점받는 것이
 * 분리되어 있다. 여기서 저장된 답이 나중에 한 번의 호출로 전부 채점된다.
 */
export async function saveAnswers(
  db: Db, planId: number, topicId: string, answers: Record<string, string>,
): Promise<void> {
  await db.update(planItems)
    .set({ answers, status: 'studying' })
    .where(and(
      eq(planItems.planId, planId),
      eq(planItems.topicId, topicId),
      // 채점이 끝난 항목의 답을 덮어쓰지 않는다
      eq(planItems.status, 'studying'),
    ))
}

/** 계획 항목 하나에 결과를 기록한다. 숙련도 갱신은 호출자가 한다. */
export async function recordItemResult(
  db: Db, planId: number, topicId: string,
  result: { attemptNo: number; answers?: unknown; feedback?: unknown; score: number },
): Promise<void> {
  await db.update(planItems)
    .set({
      status: 'done',
      attemptNo: result.attemptNo,
      answers: result.answers ?? null,
      feedback: result.feedback ?? null,
      score: result.score,
    })
    .where(and(eq(planItems.planId, planId), eq(planItems.topicId, topicId)))
}

/** 모든 항목이 끝났으면 계획을 완료로 넘긴다. */
export async function completePlanIfDone(
  db: Db, clock: Clock, planId: number,
): Promise<boolean> {
  const items = await db.select().from(planItems).where(eq(planItems.planId, planId))
  if (items.length === 0 || items.some((i) => i.status !== 'done' && i.status !== 'skipped')) {
    return false
  }

  await db.update(dailyPlans)
    .set({ status: 'completed', completedAt: clock.now() })
    .where(eq(dailyPlans.id, planId))
  return true
}
