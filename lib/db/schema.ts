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

// ── 설정 ────────────────────────────────────────

/**
 * 사용자는 한 명이지만 설정을 코드에 박지 않는다.
 * 목표 기간과 하루 시간이 바뀌면 계획이 통째로 달라진다 — 그건 데이터다.
 */
export const users = pgTable('users', {
  id:                bigserial('id', { mode: 'number' }).primaryKey(),
  targetDayCount:    integer('target_day_count').notNull().default(90),
  dailyStudyMinutes: integer('daily_study_minutes').notNull().default(60),
  /** { english: 0.3, math: 0.3, cs: 0.4 } — 합이 1 이 아니어도 정규화한다 */
  subjectPriority:   jsonb('subject_priority').notNull().default({}),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('target_days_sane', sql`${t.targetDayCount} BETWEEN 7 AND 730`),
  check('daily_minutes_sane', sql`${t.dailyStudyMinutes} BETWEEN 10 AND 480`),
])

// ── 생성된 콘텐츠 ────────────────────────────────

/**
 * ★ 멱등성 ②겹의 자리. Topic 당 콘텐츠는 평생 한 번만 만든다.
 *
 * 1주차에는 이 역할을 study_days UNIQUE(subject, day_no) 가 했다.
 * Day 가 가변이 되면서 키를 Topic 으로 옮겼다 — 강도는 그대로다.
 */
export const topicContents = pgTable('topic_contents', {
  topicId:          text('topic_id').primaryKey(),   // 'math.la.vector-ops'
  content:          jsonb('content').notNull(),      // 지문 + 문제 + 루브릭 (루브릭은 서버에만)
  model:            text('model').notNull(),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costMicros:       bigint('cost_micros', { mode: 'number' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * 복습 콘텐츠. 회차가 키에 들어간다.
 *
 * ★ CHECK 로 회차를 4로 묶어 **무한 생성을 원리적으로 막는다.**
 * 복습은 매번 달라야 하므로(설계 §8.4) 회차마다 새로 만들지만,
 * 그 횟수는 Topic 당 최대 4번이다.
 */
export const reviewItems = pgTable('review_items', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  topicId:   text('topic_id').notNull(),
  round:     integer('round').notNull(),
  content:   jsonb('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('review_round_cap', sql`${t.round} BETWEEN 1 AND 4`),
  uniqueIndex('one_content_per_round').on(t.topicId, t.round),
])

// ── 진도 ────────────────────────────────────────

/**
 * Topic 별 숙련도.
 *
 * 과목별 진도(SubjectProgress)는 테이블로 두지 않는다. 여기와 커리큘럼
 * 그래프에서 파생한다 — 두 곳에 같은 사실을 두면 어긋났을 때 진실을
 * 정할 수 없다 (1주차의 결정을 계승).
 */
export const topicProgress = pgTable('topic_progress', {
  topicId:       text('topic_id').primaryKey(),
  status:        text('status').notNull().default('not_started'),
  masteryScore:  integer('mastery_score').notNull().default(0),
  attemptCount:  integer('attempt_count').notNull().default(0),
  correctCount:  integer('correct_count').notNull().default(0),
  wrongCount:    integer('wrong_count').notNull().default(0),
  /** 반복해서 틀린 개념. 채점이 제안하고 여기 누적된다 */
  weakConcepts:  jsonb('weak_concepts').notNull().default([]),
  lastStudiedAt: timestamp('last_studied_at', { withTimezone: true }),
  /** KST 날짜. null 이면 복습 예정 없음 */
  nextReviewAt:  date('next_review_at'),
  reviewRound:   integer('review_round').notNull().default(0),
}, (t) => [
  check('status_valid', sql`${t.status} IN ('not_started','learning','weak','reviewing','mastered')`),
  check('score_range', sql`${t.masteryScore} BETWEEN 0 AND 100`),
  check('review_round_range', sql`${t.reviewRound} BETWEEN 0 AND 4`),
  index('topic_progress_next_review_idx').on(t.nextReviewAt),
])

// ── 하루 계획 ────────────────────────────────────

/**
 * 하루 계획. 생성 시점에 확정되고 그날 안에서는 바뀌지 않는다.
 *
 * ★ estimatedCalls 가 계획 시점에 정해진다. 계획을 세우는 단계는
 * LLM 을 한 번도 부르지 않으므로, "오늘 몇 번 부를지"를 호출 전에 안다.
 */
export const dailyPlans = pgTable('daily_plans', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  dayNumber:        integer('day_number').notNull(),
  studyDate:        date('study_date').notNull(),   // KST
  estimatedCalls:   integer('estimated_calls').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  status:           text('status').notNull().default('planned'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:      timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  check('plan_status_valid', sql`${t.status} IN ('planned','in_progress','completed')`),
  // 하루에 계획 하나. 새로고침으로 두 번 만들어지지 않는다.
  uniqueIndex('one_plan_per_date').on(t.studyDate),
  uniqueIndex('one_plan_per_day_number').on(t.dayNumber),
])

/**
 * 계획의 각 항목.
 *
 * attemptNo 의 CHECK 가 채점 상한 2회를 강제한다 — 1주차의 attempts 에
 * 있던 그 제약을 그대로 옮겼다.
 */
export const planItems = pgTable('plan_items', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  planId:    bigint('plan_id', { mode: 'number' })
               .notNull().references(() => dailyPlans.id, { onDelete: 'cascade' }),
  topicId:   text('topic_id').notNull(),
  kind:      text('kind').notNull(),        // new | review | remediation
  /** 복습이면 몇 회차인가. 신규·보충은 null */
  round:     integer('round'),
  minutes:   integer('minutes').notNull(),
  priority:  integer('priority').notNull(),
  status:    text('status').notNull().default('pending'),
  attemptNo: integer('attempt_no'),
  answers:   jsonb('answers'),
  feedback:  jsonb('feedback'),
  score:     integer('score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('item_kind_valid', sql`${t.kind} IN ('new','review','remediation')`),
  check('item_status_valid', sql`${t.status} IN ('pending','studying','graded','done','skipped')`),
  // 제약 ③: 채점 재시도 상한 2회. 채점도 LLM 호출이므로 비용 게이트다.
  check('attempt_cap', sql`${t.attemptNo} IS NULL OR ${t.attemptNo} BETWEEN 1 AND 2`),
  check('item_score_range', sql`${t.score} IS NULL OR ${t.score} BETWEEN 0 AND 100`),
  // 같은 계획에 같은 Topic 이 두 번 들어가지 않는다
  uniqueIndex('one_item_per_topic_per_plan').on(t.planId, t.topicId),
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
  route:            text('route').notNull(),      // 'content' | 'grade' | 'review'
  subject:          text('subject'),
  model:            text('model').notNull(),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costMicros:       bigint('cost_micros', { mode: 'number' }),
  ok:               boolean('ok').notNull(),
  // 2026-11-16 자유학습. nullable — 그 전에 쌓인 행은 그대로 읽힌다.
  requestId:        text('request_id'),
  studySessionId:   bigint('study_session_id', { mode: 'number' }),
})

// ── 자유학습 ─────────────────────────────────────
//
// 설계: docs/specs/2026-11-16-free-study-modes-design.md §2
// 커리큘럼 경로의 테이블과 공유하지 않는다. `sessions` 는 로그인이고
// 학습 세션은 `study_sessions` 다.

/** 과목 모드. 커리큘럼의 `mode`(new·review·remediation)·`kind` 와 다른 축이다 */
export const studySessions = pgTable('study_sessions', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  studyMode: text('study_mode').notNull(),
  title:     text('title').notNull(),
  /** 처음 입력한 요청 원문 */
  request:   text('request').notNull(),
  /** 수준·활동·도움 선호. 모델의 note 와 사용자 조정이 쌓인다 */
  prefs:     jsonb('prefs').notNull().default({}),
  /** 긴 대화를 다 보내지 않기 위한 누적 요약 */
  summary:   text('summary').notNull().default(''),
  status:    text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('study_mode_valid', sql`${t.studyMode} IN ('english','math','cs','coding')`),
  check('study_status_valid', sql`${t.status} IN ('active','archived')`),
  index('study_sessions_updated_idx').on(t.updatedAt.desc()),
])

export const studyMaterials = pgTable('study_materials', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId:     bigint('session_id', { mode: 'number' }).notNull().references(() => studySessions.id),
  version:       integer('version').notNull(),
  /** 이 자료가 어느 자료에서 이어졌는가. 덮어쓰지 않고 쌓는다 */
  parentId:      bigint('parent_id', { mode: 'number' }),
  activity:      text('activity').notNull(),
  /** 공개부만. 문제의 정답·해설은 study_problems.private 에 있다 */
  content:       jsonb('content').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  requestId:     text('request_id').notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('one_material_per_version').on(t.sessionId, t.version),
])

/**
 * ★ 비공개부는 컬럼이 다르다. `private` 는 정답·루브릭·해설·단계 힌트이며
 * 밖으로는 `publicProblem()` 투영만 나간다 (lib/study/schemas.ts).
 */
export const studyProblems = pgTable('study_problems', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId:        bigint('session_id', { mode: 'number' }).notNull().references(() => studySessions.id),
  materialId:       bigint('material_id', { mode: 'number' }).notNull().references(() => studyMaterials.id),
  /** 세션 전체 일련번호. 「2번 문제」가 자료 버전을 넘어 같은 것을 가리킨다 */
  number:           integer('number').notNull(),
  public:           jsonb('public').notNull(),
  private:          jsonb('private').notNull(),
  hintsRevealed:    integer('hints_revealed').notNull().default(0),
  solutionRevealed: boolean('solution_revealed').notNull().default(false),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('hints_revealed_range', sql`${t.hintsRevealed} BETWEEN 0 AND 3`),
  uniqueIndex('one_problem_per_number').on(t.sessionId, t.number),
])

export const studyMessages = pgTable('study_messages', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId:  bigint('session_id', { mode: 'number' }).notNull().references(() => studySessions.id),
  role:       text('role').notNull(),
  kind:       text('kind').notNull(),
  bodyMd:     text('body_md').notNull(),
  requestId:  text('request_id'),
  materialId: bigint('material_id', { mode: 'number' }),
  problemId:  bigint('problem_id', { mode: 'number' }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('message_role_valid', sql`${t.role} IN ('user','assistant')`),
  check('message_kind_valid', sql`${t.kind} IN ('chat','material','feedback','notice')`),
  index('study_messages_session_idx').on(t.sessionId, t.id),
])

export const studySubmissions = pgTable('study_submissions', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  problemId:    bigint('problem_id', { mode: 'number' }).notNull().references(() => studyProblems.id),
  attemptNo:    integer('attempt_no').notNull(),
  answer:       text('answer').notNull(),
  language:     text('language'),
  feedbackMode: text('feedback_mode').notNull(),
  feedback:     jsonb('feedback').notNull(),
  verdict:      text('verdict').notNull(),
  requestId:    text('request_id').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 문제당 제출 상한. 제출마다 유료 피드백이 나가므로 비용 게이트다.
  check('submission_attempt_cap', sql`${t.attemptNo} BETWEEN 1 AND 20`),
  check('feedback_mode_valid', sql`${t.feedbackMode} IN ('full','errors-only')`),
  uniqueIndex('one_submission_per_attempt').on(t.problemId, t.attemptNo),
])

/**
 * ★ 자유학습의 멱등성 자리. 화면이 전송마다 만든 UUID 가 PK 다.
 * 같은 ID 가 다시 오면 처리하지 않고 저장된 결과를 돌려준다.
 */
export const aiRequests = pgTable('ai_requests', {
  requestId:  text('request_id').primaryKey(),
  sessionId:  bigint('session_id', { mode: 'number' }),
  action:     text('action').notNull(),
  status:     text('status').notNull().default('pending'),
  /** 공개 가능한 결과만 (ID 들). 자료 본문을 담지 않는다 */
  result:     jsonb('result'),
  errorCode:  text('error_code'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  check('ai_request_status_valid', sql`${t.status} IN ('pending','done','failed')`),
])
