import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema'
import type { Db } from '../db/types'
import { SUBJECTS } from '../curriculum/schema'

/**
 * 사용자 설정. 한 행뿐이다.
 *
 * ★ 여기 값이 바뀌면 계획이 통째로 달라진다. 그래서 코드에 박지 않고
 * 데이터로 둔다 (1단계의 결정).
 */

/**
 * 경계값은 DB 의 CHECK 제약과 같아야 한다 (`lib/db/schema.ts`).
 * 여기서 먼저 걸러야 라우트가 500 대신 400 을 준다 — 사용자에게
 * "무엇이 잘못됐는지" 말할 수 있는 건 이쪽뿐이다.
 */
export const TARGET_DAYS_MIN = 7
export const TARGET_DAYS_MAX = 730
export const DAILY_MINUTES_MIN = 10
export const DAILY_MINUTES_MAX = 480

const Ratio = z.number().min(0).max(1)

export const SettingsSchema = z.object({
  targetDayCount: z.number().int().min(TARGET_DAYS_MIN).max(TARGET_DAYS_MAX),
  dailyStudyMinutes: z.number().int().min(DAILY_MINUTES_MIN).max(DAILY_MINUTES_MAX),
  /**
   * 과목별 비중. 합이 1 이 아니어도 된다 — 계획 엔진이 정규화한다.
   * 0 은 "이 과목을 당분간 쉰다"는 뜻이고, 전부 0 이면 기본값으로 돌아간다.
   *
   * 세 과목을 모두 요구한다. 빠진 과목이 "0"인지 "기본값"인지 모호해지면
   * 화면과 엔진이 다르게 읽는다.
   */
  subjectPriority: z.object({
    english: Ratio,
    math: Ratio,
    cs: Ratio,
  }),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  targetDayCount: 90,
  dailyStudyMinutes: 60,
  subjectPriority: { english: 0.3, math: 0.3, cs: 0.4 },
}

/**
 * jsonb 는 `unknown` 으로 온다. 모양이 깨졌으면 기본값으로 떨어뜨린다 —
 * 설정 하나 때문에 계획을 못 세우는 일이 없어야 한다.
 */
function readPriority(raw: unknown): Settings['subjectPriority'] {
  const parsed = SettingsSchema.shape.subjectPriority.safeParse(raw)
  if (!parsed.success) return DEFAULT_SETTINGS.subjectPriority

  // 전부 0 이면 계획 엔진이 0 으로 나눈다. 그건 설정이 아니라 사고다.
  const sum = SUBJECTS.reduce((n, s) => n + parsed.data[s], 0)
  return sum > 0 ? parsed.data : DEFAULT_SETTINGS.subjectPriority
}

/** 설정은 한 행뿐이다. 없으면 기본값으로 만든다. */
export async function loadSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(users).limit(1)
  if (!row) {
    await db.insert(users).values({}).onConflictDoNothing()
    return DEFAULT_SETTINGS
  }

  return {
    targetDayCount: row.targetDayCount,
    dailyStudyMinutes: row.dailyStudyMinutes,
    subjectPriority: readPriority(row.subjectPriority),
  }
}

/**
 * 설정을 저장한다.
 *
 * ★ 오늘 계획은 바뀌지 않는다. `one_plan_per_date` 가 하루에 계획 하나를
 * 강제하고, 그날 안에서는 다시 세우지 않는다 (2단계의 결정). 새 설정은
 * 내일 계획부터 적용된다 — 화면이 그것을 그대로 말한다.
 */
export async function saveSettings(db: Db, settings: Settings): Promise<Settings> {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1)

  if (existing) {
    await db.update(users).set(settings).where(eq(users.id, existing.id))
  } else {
    await db.insert(users).values(settings)
  }
  return settings
}
