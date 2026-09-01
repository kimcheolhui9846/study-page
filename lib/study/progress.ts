import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import { kstToday, kstMonth, type Clock } from '../time'
import { loadCurriculum, SUBJECTS, type DayEntry, type Subject } from '../curriculum/load'
import { budgetCounters } from '../db/schema'
import { dailyCallCap, monthlyCostCapMicros } from '../budget/caps'
import { eq } from 'drizzle-orm'

/** 오늘 이 과목이 어디까지 왔는지. */
export type TodayState = 'none' | 'in_progress' | 'completed' | 'abandoned'

export interface SubjectProgress {
  subject: Subject
  label: string
  /** 오늘 할(또는 오늘 한) Day 번호. 커리큘럼을 다 마쳤으면 총 일수 + 1 이 된다. */
  dayNo: number
  totalDays: number
  /** dayNo 에 해당하는 커리큘럼 항목. 커리큘럼을 다 마쳤으면 null. */
  entry: DayEntry | null
  today: TodayState
}

/**
 * 진도는 `study_days` 에서 파생한다. `progress` 테이블을 만들지 않는다.
 *
 * 별도 테이블을 두면 두 곳이 어긋날 수 있고, 어긋났을 때 어느 쪽이 진실인지
 * 정할 방법이 없다. 학습 기록 자체가 진도다.
 *
 * 전체 행을 읽어 JS 에서 접는다. 과목 3개 × Day 수십 개라 SQL 집계로 얻는
 * 이득이 없고, 이 방식이 읽기 쉽다. 행이 수천으로 늘면 그때 GROUP BY 로 바꾼다.
 */
export async function loadProgress(db: Db, clock: Clock): Promise<SubjectProgress[]> {
  const today = kstToday(clock.now())

  const rows = await db
    .select({
      subject: studyDays.subject,
      dayNo: studyDays.dayNo,
      studyDate: studyDays.studyDate,
      status: studyDays.status,
    })
    .from(studyDays)

  return SUBJECTS.map((subject) => {
    const mine = rows.filter((r) => r.subject === subject)
    const todayRow = mine.find((r) => r.studyDate === today)

    // 오늘 이미 연 Day 가 있으면 그것이 오늘의 Day 다.
    // 없으면 여태 연 것 중 가장 큰 번호의 다음이 오늘 열 Day 다.
    const maxDay = mine.reduce((max, r) => Math.max(max, r.dayNo), 0)
    const dayNo = todayRow ? todayRow.dayNo : maxDay + 1

    const curriculum = loadCurriculum(subject)

    return {
      subject,
      label: curriculum.label,
      dayNo,
      totalDays: curriculum.days.length,
      entry: curriculum.days.find((d) => d.day === dayNo) ?? null,
      today: (todayRow?.status ?? 'none') as TodayState,
    }
  })
}

export interface UsageSnapshot {
  dailyCalls: number
  dailyCap: number
  monthlyCostMicros: number
  monthlyCapMicros: number
}

/**
 * 예산 계기판. 대시보드 아래에 조용히 놓인다.
 *
 * 카운터 행은 첫 예약 때 만들어진다. 아직 없으면 0 이다 — 없는 것과
 * 0 회 쓴 것은 사용자에게 같은 뜻이다.
 */
export async function loadUsage(db: Db, clock: Clock): Promise<UsageSnapshot> {
  const now = clock.now()

  const [day] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, `day:${kstToday(now)}`))
  const [month] = await db.select().from(budgetCounters)
    .where(eq(budgetCounters.periodKey, `month:${kstMonth(now)}`))

  return {
    dailyCalls: day?.calls ?? 0,
    dailyCap: day?.capCalls ?? dailyCallCap(),
    monthlyCostMicros: month?.costMicros ?? 0,
    monthlyCapMicros: month?.capMicros ?? monthlyCostCapMicros(),
  }
}
