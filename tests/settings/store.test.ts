import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { users } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'
import {
  loadSettings, saveSettings, SettingsSchema, DEFAULT_SETTINGS,
  TARGET_DAYS_MIN, TARGET_DAYS_MAX, DAILY_MINUTES_MIN, DAILY_MINUTES_MAX,
} from '../../lib/settings/store'
import { ensureTodayPlan } from '../../lib/plan/store'

let db: Db
let close: () => Promise<void>

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

describe('설정 읽기', () => {
  it('행이 없으면 기본값을 주고 만든다', async () => {
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('두 번 읽어도 행이 하나다', async () => {
    await loadSettings(db)
    await loadSettings(db)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('★ 깨진 subject_priority 는 기본값으로 떨어뜨린다 — 설정 하나로 계획이 멈추면 안 된다', async () => {
    await db.insert(users).values({ subjectPriority: { english: '많이' } })
    expect((await loadSettings(db)).subjectPriority).toEqual(DEFAULT_SETTINGS.subjectPriority)
  })

  it('★ 전부 0 이면 기본값으로 돌아간다 — 계획 엔진이 0 으로 나눈다', async () => {
    await db.insert(users).values({ subjectPriority: { english: 0, math: 0, cs: 0 } })
    expect((await loadSettings(db)).subjectPriority).toEqual(DEFAULT_SETTINGS.subjectPriority)
  })

  it('한 과목만 0 인 것은 그대로 쓴다 — "이 과목을 쉰다"는 뜻이다', async () => {
    await db.insert(users).values({ subjectPriority: { english: 0.5, math: 0, cs: 0.5 } })
    expect((await loadSettings(db)).subjectPriority).toEqual({ english: 0.5, math: 0, cs: 0.5 })
  })
})

describe('설정 저장', () => {
  const custom = {
    targetDayCount: 30,
    dailyStudyMinutes: 45,
    subjectPriority: { english: 0.5, math: 0.2, cs: 0.3 },
  }

  it('저장하고 다시 읽으면 같다', async () => {
    await loadSettings(db)
    await saveSettings(db, custom)
    expect(await loadSettings(db)).toEqual(custom)
  })

  it('행이 없어도 저장된다', async () => {
    await saveSettings(db, custom)
    expect(await loadSettings(db)).toEqual(custom)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('★ 두 번 저장해도 행이 하나다 — 설정은 하나뿐이다', async () => {
    await saveSettings(db, custom)
    await saveSettings(db, { ...custom, targetDayCount: 60 })

    expect(await db.select().from(users)).toHaveLength(1)
    expect((await loadSettings(db)).targetDayCount).toBe(60)
  })
})

describe('검증', () => {
  const ok = DEFAULT_SETTINGS

  it('경계값은 통과한다', () => {
    for (const targetDayCount of [TARGET_DAYS_MIN, TARGET_DAYS_MAX]) {
      expect(SettingsSchema.safeParse({ ...ok, targetDayCount }).success).toBe(true)
    }
    for (const dailyStudyMinutes of [DAILY_MINUTES_MIN, DAILY_MINUTES_MAX]) {
      expect(SettingsSchema.safeParse({ ...ok, dailyStudyMinutes }).success).toBe(true)
    }
  })

  it('★ 범위 밖은 막는다 — DB CHECK 에 닿기 전에', () => {
    const bad = [
      { ...ok, targetDayCount: TARGET_DAYS_MIN - 1 },
      { ...ok, targetDayCount: TARGET_DAYS_MAX + 1 },
      { ...ok, dailyStudyMinutes: DAILY_MINUTES_MIN - 1 },
      { ...ok, dailyStudyMinutes: DAILY_MINUTES_MAX + 1 },
    ]
    for (const b of bad) expect(SettingsSchema.safeParse(b).success).toBe(false)
  })

  it('소수 날짜는 막는다', () => {
    expect(SettingsSchema.safeParse({ ...ok, targetDayCount: 30.5 }).success).toBe(false)
  })

  it('★ 세 과목을 다 요구한다 — 빠진 것이 0 인지 기본값인지 모호해진다', () => {
    const partial = { ...ok, subjectPriority: { english: 0.5, math: 0.5 } }
    expect(SettingsSchema.safeParse(partial).success).toBe(false)
  })

  it('비중이 0~1 밖이면 막는다', () => {
    const over = { ...ok, subjectPriority: { english: 1.5, math: 0.3, cs: 0.4 } }
    expect(SettingsSchema.safeParse(over).success).toBe(false)
  })

  it('비중의 합이 1 이 아니어도 통과한다 — 계획 엔진이 정규화한다', () => {
    const loose = { ...ok, subjectPriority: { english: 1, math: 1, cs: 1 } }
    expect(SettingsSchema.safeParse(loose).success).toBe(true)
  })
})

describe('설정이 계획에 실제로 닿는다', () => {
  const clock = fixedClock('2026-09-01T10:00:00+09:00')

  it('★ 하루 시간을 줄이면 계획이 짧아진다', async () => {
    await saveSettings(db, { ...DEFAULT_SETTINGS, dailyStudyMinutes: 300 })
    const long = await ensureTodayPlan(db, clock, 50)

    const { db: db2, close: close2 } = await createTestDb()
    await saveSettings(db2, { ...DEFAULT_SETTINGS, dailyStudyMinutes: 20 })
    const short = await ensureTodayPlan(db2, clock, 50)
    await close2()

    expect(short.estimatedMinutes).toBeLessThan(long.estimatedMinutes)
  })

  it('★ 과목 비중이 계획에 반영된다 — 저장만 되고 마는 컬럼이 아니다', async () => {
    // 영어만 남기고 나머지를 0 으로. 하루 분량을 넉넉히 줘서 여러 개가 담기게 한다.
    await saveSettings(db, {
      targetDayCount: 90,
      dailyStudyMinutes: 240,
      subjectPriority: { english: 1, math: 0, cs: 0 },
    })
    const plan = await ensureTodayPlan(db, clock, 50)

    const english = plan.items.filter((i) => i.topicId.startsWith('english.')).length
    expect(plan.items.length).toBeGreaterThan(0)
    expect(english).toBeGreaterThan(plan.items.length / 2)
  })
})

describe('비중 0 은 "쉰다"는 뜻이다', () => {
  const clock = fixedClock('2026-09-01T10:00:00+09:00')

  it('★ 0 인 과목은 남는 시간에도 안 끼워 넣는다', async () => {
    await saveSettings(db, {
      targetDayCount: 90,
      dailyStudyMinutes: 240,
      subjectPriority: { english: 1, math: 0, cs: 0 },
    })
    const plan = await ensureTodayPlan(db, clock, 50)

    expect(plan.items.length).toBeGreaterThan(0)
    for (const i of plan.items) expect(i.topicId.startsWith('english.'), i.topicId).toBe(true)
  })

  it('0 이 아닌 과목은 남는 시간을 받는다 — 하루가 짧아질 이유는 없다', async () => {
    await saveSettings(db, {
      targetDayCount: 90,
      dailyStudyMinutes: 240,
      subjectPriority: { english: 0.9, math: 0.05, cs: 0.05 },
    })
    const plan = await ensureTodayPlan(db, clock, 50)

    const subjects = new Set(plan.items.map((i) => i.topicId.split('.')[0]))
    expect(subjects.size).toBeGreaterThan(1)
  })
})
