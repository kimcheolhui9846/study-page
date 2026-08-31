import { sql } from 'drizzle-orm'
import {
  pgTable, text, integer, bigint, bigserial, boolean,
  timestamp, date, jsonb, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core'

// ── 세션 ────────────────────────────────────────

export const sessions = pgTable('sessions', {
  tokenHash:     text('token_hash').primaryKey(),   // sha256(원본토큰). 원본은 DB에 없다
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:    timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(), // 활동마다 밀린다
  expiresAt:     timestamp('expires_at', { withTimezone: true }).notNull(),      // 절대. 밀리지 않는다
  revokedAt:     timestamp('revoked_at', { withTimezone: true }),
})

export const loginAttempts = pgTable('login_attempts', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  ip:          text('ip'),
  succeeded:   boolean('succeeded').notNull(),
}, (t) => [index('login_attempts_attempted_at_idx').on(t.attemptedAt.desc())])

// ── 학습 ────────────────────────────────────────

export const studyDays = pgTable('study_days', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  subject:     text('subject').notNull(),
  dayNo:       integer('day_no').notNull(),
  studyDate:   date('study_date').notNull(),   // KST 기준 진행일
  status:      text('status').notNull().default('in_progress'),
  content:     jsonb('content').notNull(),     // LLM 생성 지문 + 문제 + 루브릭
  startedAt:   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  check('status_valid', sql`${t.status} IN ('in_progress','completed','abandoned')`),
  // 제약 ①: Day 5 콘텐츠는 평생 딱 한 번만 생성된다 (멱등성)
  uniqueIndex('one_row_per_day').on(t.subject, t.dayNo),
  // 제약 ②: 한 과목은 하루에 한 Day만 (당일 추가 생성 없음)
  uniqueIndex('one_day_per_date').on(t.subject, t.studyDate),
])

export const attempts = pgTable('attempts', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  studyDayId: bigint('study_day_id', { mode: 'number' })
                .notNull().references(() => studyDays.id, { onDelete: 'cascade' }),
  attemptNo:  integer('attempt_no').notNull(),
  answers:    jsonb('answers').notNull(),
  feedback:   jsonb('feedback'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 제약 ③: 채점 재시도 상한 2회. 채점도 LLM 호출이므로 비용 게이트다
  check('attempt_cap', sql`${t.attemptNo} BETWEEN 1 AND 2`),
  uniqueIndex('one_attempt_no_per_day').on(t.studyDayId, t.attemptNo),
])

export const summaries = pgTable('summaries', {
  studyDayId:   bigint('study_day_id', { mode: 'number' })
                  .primaryKey().references(() => studyDays.id, { onDelete: 'cascade' }),
  rawText:      text('raw_text').notNull(),       // 사용자가 쓴 최종 정리본
  polishedText: text('polished_text'),            // 말투 다듬기 통과본
  polishedAt:   timestamp('polished_at', { withTimezone: true }),
  polishCount:  integer('polish_count').notNull().default(0),
  velogUrl:     text('velog_url'),                // 채워져 있으면 발행됨
  publishedAt:  timestamp('published_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 제약 ④: 다듬기 재시도 상한 2회
  check('polish_cap', sql`${t.polishCount} BETWEEN 0 AND 2`),
])

// ── 비용 ────────────────────────────────────────

export const budgetCounters = pgTable('budget_counters', {
  periodKey:  text('period_key').primaryKey(),                 // 'day:2026-09-01' | 'month:2026-09'
  calls:      integer('calls').notNull().default(0),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0), // USD × 1e6. 정수
  capCalls:   integer('cap_calls').notNull(),
  capMicros:  bigint('cap_micros', { mode: 'number' }).notNull(),
})

export const usageLedger = pgTable('usage_ledger', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  route:            text('route').notNull(),      // 'content' | 'grade' | 'polish'
  subject:          text('subject'),
  model:            text('model').notNull(),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costMicros:       bigint('cost_micros', { mode: 'number' }),
  ok:               boolean('ok').notNull(),
})
