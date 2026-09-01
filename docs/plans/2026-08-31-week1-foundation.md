# 1주차 구현 계획 — 뼈대와 방어선

> **에이전트 작업자에게:** 이 계획은 `superpowers:subagent-driven-development` 또는
> `superpowers:executing-plans`로 태스크 단위 실행할 것. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 로그인 · 세션 만료 · 예산 상한이 자동 테스트로 증명되는 Next.js 앱을 만든다. **LLM은 한 번도 호출하지 않는다.**

**접근:** 돈이 나가는 코드를 마지막에 꽂는다. LLM 자리에는 `FakeLlmClient`를 두고, 보안·예산 계층을 먼저 완성한다. 반대 순서면 개발 중에 새는 것이 정상이 된다.

**스택:** Next.js (App Router) · TypeScript · Tailwind · Drizzle ORM · Neon Postgres (프로덕션) / PGlite (테스트) · Vitest

**스펙:** [`docs/specs/2026-08-31-ai-study-page-design.md`](../specs/2026-08-31-ai-study-page-design.md)

---

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **1주차에 실제 LLM을 호출하지 않는다.** `OPENAI_API_KEY`를 `.env`에 넣지도 않는다.
- **`NEXT_PUBLIC_` 환경변수를 하나도 만들지 않는다.** 0개가 목표이며 `npm run check:secrets`가 강제한다.
- **`new Date()`로 날짜(연·월·일)를 만들지 않는다.** 날짜는 KST 기준이며 `kstToday()`만 쓴다. 시각(instant)은 `Clock`으로 주입한다.
- **테스트에서 `sleep`을 쓰지 않는다.** 시간은 `Clock` 주입으로 조작한다.
- **테스트는 PGlite 인메모리 Postgres에서 돈다.** 외부 DB 없이 `npm test`가 통과해야 한다.
- 유휴 만료 **15분**, 절대 만료 **2시간**.
- 일일 호출 캡: Production **20**, Preview·Local **3**.
- 로그인 실패 잠금: 15분 내 **5회**.
- `main`에 직접 커밋하지 않는다. 태스크 하나 = 브랜치 하나 = PR 하나.
- 커밋 저자는 사용자 단독. AI 공동저자 트레일러 금지.
- 각 태스크의 마지막 커밋 전에 `docs/HANDOFF.md`를 갱신한다.

---

## 파일 구조

이 계획이 만드는 파일과 각각의 책임.

| 파일 | 책임 |
|---|---|
| `scripts/check-secrets.mjs` | 소스에 `NEXT_PUBLIC_`가 있으면 실패 |
| `scripts/hash-password.mjs` | 비밀번호 해시 생성 CLI (`AUTH_PASSWORD_HASH`용) |
| `lib/time.ts` | `kstToday()`, `Clock` 주입 지점 |
| `lib/db/schema.ts` | Drizzle 테이블 정의 7개 |
| `lib/db/types.ts` | `Db` 타입 별칭 (Neon과 PGlite 공통) |
| `lib/db/client.ts` | 프로덕션 Neon 연결 |
| `lib/curriculum/schema.ts` | 커리큘럼 zod 스키마 |
| `lib/curriculum/load.ts` | YAML 로드 + 검증 |
| `lib/session/store.ts` | `SessionStore` 인터페이스, TTL 상수 |
| `lib/session/postgres.ts` | `PostgresSessionStore` 구현 |
| `lib/session/guard.ts` | `withSession()` — 모든 보호 라우트의 단일 입구 |
| `lib/auth/password.ts` | scrypt 해시/검증 |
| `lib/auth/lockout.ts` | 로그인 실패 잠금 |
| `lib/budget/caps.ts` | 환경별 캡 값 |
| `lib/budget/reserve.ts` | 원자적 예약 · 롤백 · 사용량 기록 |
| `lib/llm/types.ts` | `LlmClient` 인터페이스 |
| `lib/llm/fake.ts` | `FakeLlmClient` — 1주차의 유일한 구현체 |
| `app/api/session/route.ts` | POST 로그인 |
| `app/api/session/end/route.ts` | POST 종료 (버튼 + sendBeacon 공용) |
| `app/api/study/[subject]/content/route.ts` | 4겹 방어가 전부 붙은 대표 라우트 |
| `app/login/page.tsx` | 로그인 화면 |
| `app/page.tsx` | 대시보드 |
| `components/SessionBar.tsx` | 카운트다운 · 종료 버튼 · `pagehide` beacon |
| `curriculum/{english,math,cs}.yaml` | Day 1~7 |
| `tests/helpers/testDb.ts` | PGlite 하네스 |
| `tests/helpers/clock.ts` | 시간 조작 |

**태스크 = 브랜치 = PR** 대응:

| # | 브랜치 | 산출물 |
|---|---|---|
| 1 | `feat/scaffold` | 앱 뼈대 + 테스트 러너 + 비밀 검사 |
| 2 | `feat/db-schema` | 스키마 + 마이그레이션 + 제약 테스트 |
| 3 | `feat/time` | `kstToday()` + `Clock` |
| 4 | `feat/curriculum` | zod 로더 + Day 1~7 |
| 5 | `feat/session-store` | `SessionStore` + 만료 4경로 |
| 6 | `feat/auth` | scrypt + 잠금 + 로그인 라우트 |
| 7 | `feat/session-guard` | `withSession()` + 종료 라우트 |
| 8 | `feat/budget` | 예약 · 롤백 · 사용량 기록 |
| 9 | `feat/fake-llm` | 4겹이 전부 붙은 라우트 통합 테스트 |
| 9.5 | `design/canvas` | 디자인 캔버스 — 하루 학습 전체 흐름 아트보드 7장 |
| 10 | `feat/ui-session` | 로그인 화면 · 카운트다운 · 종료 (9.5의 디자인을 구현) |

---

## Task 1: 프로젝트 뼈대 + 테스트 러너 + 비밀 검사

**Files:**
- Create: `package.json`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx` (create-next-app이 생성)
- Create: `vitest.config.ts`
- Create: `scripts/check-secrets.mjs`
- Create: `.env.example`
- Test: `tests/check-secrets.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `npm test`, `npm run check:secrets` 스크립트. 이후 모든 태스크가 이 둘에 의존한다.

- [x] **Step 1: 앱 뼈대 생성**

빈 디렉터리가 아니므로 임시 폴더에 만들고 옮긴다.

```bash
npx --yes create-next-app@latest tmp-scaffold \
  --typescript --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-npm --no-turbopack --yes

# 뼈대가 만든 CLAUDE.md / README.md / .gitignore 로 내 것을 덮어쓰지 않는다
rm -rf tmp-scaffold/.next tmp-scaffold/CLAUDE.md tmp-scaffold/README.md tmp-scaffold/.gitignore
cp -r tmp-scaffold/. .
rm -rf tmp-scaffold
```

뼈대는 `AGENTS.md`도 만든다. 이건 `next dev`가 재생성하므로 지우지 말고 커밋한다.
디렉터리 이름을 점으로 시작하면 npm 이름 규칙에 걸리므로 `tmp-scaffold`를 쓴다.

- [x] **Step 2: Vitest 설치 및 설정**

```bash
npm install -D vitest @vitejs/plugin-react
```

`vitest.config.mts` 생성 (확장자가 `.ts`면 CJS로 로드되어 경고가 난다):

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
})
```

`package.json`의 `scripts`에 추가:

```json
"test": "vitest run",
"test:watch": "vitest",
"check:secrets": "node scripts/check-secrets.mjs"
```

- [x] **Step 3: 실패하는 테스트 작성**

`tests/check-secrets.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findViolations } from '../scripts/check-secrets.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secrets-'))
  mkdirSync(join(dir, 'lib'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('findViolations', () => {
  it('NEXT_PUBLIC_ 이 없으면 위반이 없다', () => {
    writeFileSync(join(dir, 'lib', 'a.ts'), 'const key = process.env.OPENAI_API_KEY')
    expect(findViolations(dir)).toEqual([])
  })

  it('NEXT_PUBLIC_ 을 파일과 줄번호까지 찾아낸다', () => {
    writeFileSync(join(dir, 'lib', 'b.ts'), 'const a = 1\nconst k = process.env.NEXT_PUBLIC_KEY\n')
    const found = findViolations(dir)
    expect(found).toHaveLength(1)
    expect(found[0].line).toBe(2)
    expect(found[0].file).toContain('b.ts')
  })

  it('node_modules 와 .next 는 건너뛴다', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'c.ts'), 'NEXT_PUBLIC_X')
    expect(findViolations(dir)).toEqual([])
  })
})
```

- [x] **Step 4: 테스트가 실패하는지 확인**

Run: `npm test -- tests/check-secrets.test.ts`
Expected: FAIL — `Cannot find module '../scripts/check-secrets.mjs'`

- [x] **Step 5: 최소 구현**

`scripts/check-secrets.mjs`:

부정 목록(`node_modules`, `.next`, …)을 계속 늘리는 대신 **클라이언트 번들에 도달할 수
있는 디렉터리만** 검사한다. `tests/`와 `scripts/`는 번들되지 않으므로 검사하지 않는다 —
이 검사기의 테스트 자체가 `NEXT_PUBLIC_`을 픽스처로 쓰기 때문에 이 구분이 필요하다.

```js
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SCAN_DIRS = ['app', 'components', 'lib']
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

export function findViolations(root) {
  const out = []

  for (const dirName of SCAN_DIRS) {
    const dir = join(root, dirName)
    if (existsSync(dir)) walk(dir)
  }

  return out

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!EXT.test(name)) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((text, i) => {
        if (text.includes('NEXT_PUBLIC_')) {
          out.push({ file: relative(root, full), line: i + 1, text: text.trim() })
        }
      })
    }
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const violations = findViolations(process.cwd())
  if (violations.length > 0) {
    console.error('NEXT_PUBLIC_ 환경변수가 발견되었습니다. 이 프로젝트는 0개를 유지합니다.\n')
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
    process.exit(1)
  }
  console.log('OK — NEXT_PUBLIC_ 없음')
}
```

- [x] **Step 6: 테스트 통과 확인**

Run: `npm test -- tests/check-secrets.test.ts`
Expected: PASS (3 tests)

Run: `npm run check:secrets`
Expected: `OK — NEXT_PUBLIC_ 없음`, 종료 코드 0

- [x] **Step 7: `.env.example` 작성**

```
# 1주차에는 DATABASE_URL 과 AUTH_PASSWORD_HASH 만 있으면 된다.
# OPENAI_API_KEY 는 2주차에 추가한다. 지금 넣지 말 것.

DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
AUTH_PASSWORD_HASH=

# 'production' | 'preview' | 'local'
APP_ENV=local
```

- [x] **Step 8: 커밋**

```bash
git checkout -b feat/scaffold
git add -A
git commit -m "feat: 앱 뼈대와 비밀 검사 스크립트

Next.js + TS + Tailwind 뼈대에 Vitest를 얹고,
NEXT_PUBLIC_ 환경변수를 0개로 유지하는 검사를 추가한다.
검사는 PR 체크리스트 항목이다."
```

---

## Task 2: DB 스키마 + 마이그레이션 + PGlite 테스트 하네스

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/types.ts`, `lib/db/client.ts`, `drizzle.config.ts`
- Create: `tests/helpers/testDb.ts`
- Test: `tests/db/constraints.test.ts`

**Interfaces:**
- Consumes: Task 1의 `npm test`
- Produces:
  - `lib/db/schema.ts` → `sessions`, `loginAttempts`, `studyDays`, `attempts`, `summaries`, `budgetCounters`, `usageLedger`
  - `lib/db/types.ts` → `type Db`
  - `tests/helpers/testDb.ts` → `createTestDb(): Promise<{ db: Db; close(): Promise<void> }>`

- [x] **Step 1: 의존성 설치**

```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit @electric-sql/pglite
```

- [x] **Step 2: 스키마 작성**

`lib/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  pgTable, text, integer, bigint, bigserial, boolean,
  timestamp, date, jsonb, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core'

export const sessions = pgTable('sessions', {
  tokenHash:     text('token_hash').primaryKey(),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:    timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  expiresAt:     timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt:     timestamp('revoked_at', { withTimezone: true }),
})

export const loginAttempts = pgTable('login_attempts', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  ip:          text('ip'),
  succeeded:   boolean('succeeded').notNull(),
}, (t) => [index('login_attempts_attempted_at_idx').on(t.attemptedAt.desc())])

export const studyDays = pgTable('study_days', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  subject:     text('subject').notNull(),
  dayNo:       integer('day_no').notNull(),
  studyDate:   date('study_date').notNull(),
  status:      text('status').notNull().default('in_progress'),
  content:     jsonb('content').notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  check('status_valid', sql`${t.status} IN ('in_progress','completed','abandoned')`),
  uniqueIndex('one_row_per_day').on(t.subject, t.dayNo),
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
  check('attempt_cap', sql`${t.attemptNo} BETWEEN 1 AND 2`),
  uniqueIndex('one_attempt_no_per_day').on(t.studyDayId, t.attemptNo),
])

export const summaries = pgTable('summaries', {
  studyDayId:   bigint('study_day_id', { mode: 'number' })
                  .primaryKey().references(() => studyDays.id, { onDelete: 'cascade' }),
  rawText:      text('raw_text').notNull(),
  polishedText: text('polished_text'),
  polishedAt:   timestamp('polished_at', { withTimezone: true }),
  polishCount:  integer('polish_count').notNull().default(0),
  velogUrl:     text('velog_url'),
  publishedAt:  timestamp('published_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('polish_cap', sql`${t.polishCount} BETWEEN 0 AND 2`)])

export const budgetCounters = pgTable('budget_counters', {
  periodKey:   text('period_key').primaryKey(),
  calls:       integer('calls').notNull().default(0),
  costMicros:  bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  capCalls:    integer('cap_calls').notNull(),
  capMicros:   bigint('cap_micros', { mode: 'number' }).notNull(),
})

export const usageLedger = pgTable('usage_ledger', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  route:            text('route').notNull(),
  subject:          text('subject'),
  model:            text('model').notNull(),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costMicros:       bigint('cost_micros', { mode: 'number' }),
  ok:               boolean('ok').notNull(),
})
```

- [x] **Step 3: 타입 별칭과 프로덕션 클라이언트**

`lib/db/types.ts`:

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'

/** Neon(프로덕션)과 PGlite(테스트)가 모두 만족하는 공통 타입 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
```

`lib/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import type { Db } from './types'

let instance: Db | null = null

function connect(): Db {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 이 설정되지 않았습니다')
  return drizzle(url, { schema }) as unknown as Db
}

/**
 * 첫 사용 시점에 연결한다. import 만으로는 연결하지 않는다.
 *
 * Next 빌드는 라우트 모듈을 import 해서 설정을 수집한다. 모듈 최상위에서 던지면
 * DATABASE_URL 없이는 빌드 자체가 불가능해져 CI 와 타입 검사가 막힌다.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    instance ??= connect()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
```

`drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

- [x] **Step 4: 마이그레이션 SQL 생성**

`package.json`에 추가: `"db:generate": "drizzle-kit generate"`

Run: `npm run db:generate`
Expected: `drizzle/0000_*.sql` 생성됨. 파일을 열어 `CREATE TABLE` 7개와
`CONSTRAINT "attempt_cap" CHECK`, `CONSTRAINT "polish_cap" CHECK`,
`CONSTRAINT "status_valid" CHECK`, `one_row_per_day`/`one_day_per_date` UNIQUE 인덱스가
들어 있는지 눈으로 확인한다.

- [x] **Step 5: PGlite 테스트 하네스 작성**

`tests/helpers/testDb.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle')

/** 인메모리 Postgres에 마이그레이션을 적용한 새 DB를 만든다. 테스트마다 격리된다. */
export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite()
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('drizzle/ 에 마이그레이션이 없습니다. npm run db:generate 를 먼저 실행하세요')

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      if (stmt.trim()) await client.exec(stmt)
    }
  }

  const db = drizzle({ client, schema }) as unknown as Db
  return { db, close: () => client.close() }
}
```

- [x] **Step 6: 실패하는 제약 테스트 작성**

`tests/db/constraints.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { studyDays, attempts, summaries } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>

beforeEach(async () => { ({ db, close } = await createTestDb()) })
afterEach(async () => { await close() })

async function insertDay(dayNo: number, studyDate: string) {
  const [row] = await db.insert(studyDays)
    .values({ subject: 'cs', dayNo, studyDate, content: {} })
    .returning({ id: studyDays.id })
  return row.id
}

describe('study_days 제약', () => {
  it('같은 (subject, day_no) 를 두 번 넣을 수 없다 — 콘텐츠 재생성 차단', async () => {
    await insertDay(1, '2026-09-01')
    await expect(insertDay(1, '2026-09-02')).rejects.toThrow()
  })

  it('같은 과목을 하루에 두 Day 진행할 수 없다 — 당일 추가 생성 차단', async () => {
    await insertDay(1, '2026-09-01')
    await expect(insertDay(2, '2026-09-01')).rejects.toThrow()
  })

  it('다른 과목은 같은 날 진행할 수 있다', async () => {
    await insertDay(1, '2026-09-01')
    await db.insert(studyDays)
      .values({ subject: 'math', dayNo: 1, studyDate: '2026-09-01', content: {} })
    const rows = await db.select().from(studyDays)
    expect(rows).toHaveLength(2)
  })

  it('정의되지 않은 status 를 넣을 수 없다', async () => {
    await expect(
      db.insert(studyDays).values({
        subject: 'cs', dayNo: 9, studyDate: '2026-09-09', content: {}, status: 'paused',
      }),
    ).rejects.toThrow()
  })
})

describe('attempts 제약', () => {
  it('채점 3회차를 넣을 수 없다 — 재시도 상한 2회', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} })
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 2, answers: {} })
    await expect(
      db.insert(attempts).values({ studyDayId: id, attemptNo: 3, answers: {} }),
    ).rejects.toThrow()
  })

  it('같은 attempt_no 를 두 번 넣을 수 없다', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} })
    await expect(
      db.insert(attempts).values({ studyDayId: id, attemptNo: 1, answers: {} }),
    ).rejects.toThrow()
  })
})

describe('summaries 제약', () => {
  it('polish_count 가 2를 넘을 수 없다 — 다듬기 상한', async () => {
    const id = await insertDay(1, '2026-09-01')
    await db.insert(summaries).values({ studyDayId: id, rawText: '정리본', polishCount: 2 })
    await expect(
      db.update(summaries).set({ polishCount: 3 }),
    ).rejects.toThrow()
  })
})
```

- [x] **Step 7: 테스트 실행**

Run: `npm test -- tests/db/constraints.test.ts`
Expected: PASS (7 tests). 실패하면 `drizzle/*.sql`에 해당 제약이 실제로 들어갔는지 확인한다 —
Step 4의 눈 확인을 건너뛰었다면 여기서 드러난다.

- [x] **Step 8: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/db-schema
git add -A
git commit -m "feat: DB 스키마와 제약 테스트

비용 방어선 셋을 DB 제약으로 박는다.
- study_days UNIQUE (subject, day_no) — 콘텐츠 평생 1회
- study_days UNIQUE (subject, study_date) — 당일 추가 생성 없음
- attempts CHECK attempt_no BETWEEN 1 AND 2
- summaries CHECK polish_count BETWEEN 0 AND 2

테스트는 PGlite 인메모리 Postgres에서 돌아 외부 DB가 필요 없다."
```

---

## Task 3: 시간 — `kstToday()`와 주입 가능한 `Clock`

**Files:**
- Create: `lib/time.ts`
- Create: `tests/helpers/clock.ts`
- Test: `tests/time.test.ts`

**Interfaces:**
- Consumes: Task 1의 `npm test`
- Produces:
  - `lib/time.ts` → `kstToday(now: Date): string`, `kstMonth(now: Date): string`, `interface Clock { now(): Date }`, `systemClock: Clock`
  - `tests/helpers/clock.ts` → `fixedClock(iso: string): Clock & { advance(ms: number): void }`

- [x] **Step 1: 실패하는 테스트 작성**

`tests/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { kstToday, kstMonth } from '../lib/time'
import { fixedClock } from './helpers/clock'

describe('kstToday', () => {
  it('UTC 14:59 는 같은 날 (KST 23:59)', () => {
    expect(kstToday(new Date('2026-08-31T14:59:59Z'))).toBe('2026-08-31')
  })

  it('UTC 15:00 은 다음 날 (KST 00:00) — 버셀 UTC 함정', () => {
    expect(kstToday(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09-01')
  })

  it('UTC 자정은 아직 같은 날 (KST 09:00)', () => {
    expect(kstToday(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01')
  })

  it('월말을 넘어간다', () => {
    expect(kstToday(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })
})

describe('kstMonth', () => {
  it('KST 기준 월을 준다', () => {
    expect(kstMonth(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09')
    expect(kstMonth(new Date('2026-08-31T14:00:00Z'))).toBe('2026-08')
  })
})

describe('fixedClock', () => {
  it('advance 로 시간을 밀 수 있다', () => {
    const clock = fixedClock('2026-09-01T00:00:00Z')
    expect(clock.now().toISOString()).toBe('2026-09-01T00:00:00.000Z')
    clock.advance(60_000)
    expect(clock.now().toISOString()).toBe('2026-09-01T00:01:00.000Z')
  })
})
```

- [x] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- tests/time.test.ts`
Expected: FAIL — `Cannot find module '../lib/time'`

- [x] **Step 3: 최소 구현**

`lib/time.ts`:

```ts
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 기준 오늘 날짜 'YYYY-MM-DD'. 서버가 UTC로 돌아도 한국 날짜를 준다. */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** KST 기준 이번 달 'YYYY-MM' */
export function kstMonth(now: Date): string {
  return kstToday(now).slice(0, 7)
}

/** 시간을 주입 가능하게 만드는 지점. 테스트에서 sleep 을 쓰지 않기 위해 존재한다. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
```

`tests/helpers/clock.ts`:

```ts
import type { Clock } from '../../lib/time'

export function fixedClock(iso: string): Clock & { advance(ms: number): void } {
  let t = new Date(iso).getTime()
  return {
    now: () => new Date(t),
    advance: (ms: number) => { t += ms },
  }
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/time.test.ts`
Expected: PASS (7 tests)

- [x] **Step 5: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/time
git add -A
git commit -m "feat: KST 날짜 헬퍼와 주입 가능한 Clock

버셀 서버는 UTC로 돌아 CURRENT_DATE 를 쓰면 KST 오전 9시 이전에
날짜가 하루 밀린다. 날짜 계산을 kstToday() 하나로 좁힌다.

Clock 은 세션 만료 테스트에서 sleep 을 없애기 위한 주입 지점이다."
```

---

## Task 4: 커리큘럼 로더

**Files:**
- Create: `lib/curriculum/schema.ts`, `lib/curriculum/load.ts`
- Create: `curriculum/cs.yaml`, `curriculum/english.yaml`, `curriculum/math.yaml`
- Test: `tests/curriculum.test.ts`

**Interfaces:**
- Consumes: Task 1의 `npm test`
- Produces:
  - `lib/curriculum/schema.ts` → `SUBJECTS`, `type Subject`, `DayEntrySchema`, `CurriculumSchema`, `type DayEntry`, `type Curriculum`
  - `lib/curriculum/load.ts` → `loadCurriculum(subject: Subject): Curriculum`, `getDay(subject: Subject, dayNo: number): DayEntry | null`, `loadAll(): Record<Subject, Curriculum>`

- [x] **Step 1: 의존성 설치**

```bash
npm install zod yaml
```

- [x] **Step 2: 실패하는 테스트 작성**

`tests/curriculum.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CurriculumSchema, SUBJECTS } from '../lib/curriculum/schema'
import { loadCurriculum, getDay, loadAll } from '../lib/curriculum/load'

describe('CurriculumSchema', () => {
  const valid = {
    subject: 'cs',
    label: '컴퓨터 과학',
    days: [{ day: 1, topic: '프로세스와 스레드', goal: '설명할 수 있다', keywords: ['PCB'], difficulty: 2 }],
  }

  it('올바른 커리큘럼을 통과시킨다', () => {
    expect(() => CurriculumSchema.parse(valid)).not.toThrow()
  })

  it('day 번호가 1부터 시작하지 않으면 거부한다', () => {
    const bad = { ...valid, days: [{ ...valid.days[0], day: 2 }] }
    expect(() => CurriculumSchema.parse(bad)).toThrow(/1부터 연속/)
  })

  it('day 번호에 구멍이 있으면 거부한다', () => {
    const bad = { ...valid, days: [valid.days[0], { ...valid.days[0], day: 3 }] }
    expect(() => CurriculumSchema.parse(bad)).toThrow(/1부터 연속/)
  })

  it('goal 이 비면 거부한다 — goal 은 채점 기준이라 필수다', () => {
    const bad = { ...valid, days: [{ ...valid.days[0], goal: '' }] }
    expect(() => CurriculumSchema.parse(bad)).toThrow()
  })

  it('difficulty 가 범위를 벗어나면 거부한다', () => {
    const bad = { ...valid, days: [{ ...valid.days[0], difficulty: 6 }] }
    expect(() => CurriculumSchema.parse(bad)).toThrow()
  })
})

describe('실제 커리큘럼 파일', () => {
  it('세 과목 모두 로드되고 검증을 통과한다', () => {
    const all = loadAll()
    expect(Object.keys(all).sort()).toEqual([...SUBJECTS].sort())
  })

  it('세 과목 모두 Day 1~7 이 있다', () => {
    for (const subject of SUBJECTS) {
      expect(loadCurriculum(subject).days.length).toBeGreaterThanOrEqual(7)
    }
  })

  it('getDay 는 있는 Day 를 주고 없는 Day 에 null 을 준다', () => {
    expect(getDay('cs', 1)?.day).toBe(1)
    expect(getDay('cs', 9999)).toBeNull()
  })
})
```

- [x] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test -- tests/curriculum.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 4: 스키마 구현**

`lib/curriculum/schema.ts`:

```ts
import { z } from 'zod'

export const SUBJECTS = ['english', 'math', 'cs'] as const
export type Subject = (typeof SUBJECTS)[number]

export const DayEntrySchema = z.object({
  day:        z.number().int().positive(),
  topic:      z.string().min(1),
  goal:       z.string().min(1),          // 채점 기준이 되므로 비면 안 된다
  keywords:   z.array(z.string().min(1)).min(1),
  difficulty: z.number().int().min(1).max(5),
})

export const CurriculumSchema = z.object({
  subject: z.enum(SUBJECTS),
  label:   z.string().min(1),
  days:    z.array(DayEntrySchema).min(1),
}).superRefine((c, ctx) => {
  c.days.forEach((d, i) => {
    if (d.day !== i + 1) {
      ctx.addIssue({
        code: 'custom',   // zod 4. z.ZodIssueCode 는 v3 API 다
        message: `day 번호는 1부터 연속이어야 합니다. ${i} 번째 항목의 day 가 ${d.day} 입니다`,
        path: ['days', i, 'day'],
      })
    }
  })
})

export type DayEntry = z.infer<typeof DayEntrySchema>
export type Curriculum = z.infer<typeof CurriculumSchema>
```

- [x] **Step 5: 로더 구현**

`lib/curriculum/load.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { CurriculumSchema, SUBJECTS, type Curriculum, type DayEntry, type Subject } from './schema'

// 소비자가 './load' 하나만 import 하면 되게 다시 내보낸다
export type { Subject, DayEntry, Curriculum } from './schema'
export { SUBJECTS } from './schema'

const cache = new Map<Subject, Curriculum>()

export function loadCurriculum(subject: Subject): Curriculum {
  const cached = cache.get(subject)
  if (cached) return cached

  const path = join(process.cwd(), 'curriculum', `${subject}.yaml`)
  const parsed = CurriculumSchema.parse(parse(readFileSync(path, 'utf8')))
  if (parsed.subject !== subject) {
    throw new Error(`${path} 의 subject 가 '${parsed.subject}' 입니다. 파일명과 일치해야 합니다`)
  }
  cache.set(subject, parsed)
  return parsed
}

export function getDay(subject: Subject, dayNo: number): DayEntry | null {
  return loadCurriculum(subject).days.find((d) => d.day === dayNo) ?? null
}

export function loadAll(): Record<Subject, Curriculum> {
  return Object.fromEntries(SUBJECTS.map((s) => [s, loadCurriculum(s)])) as Record<Subject, Curriculum>
}
```

- [x] **Step 6: 커리큘럼 파일 작성 (Day 1~7)**

> 이 내용은 **초안**이다. 사용자가 나중에 전부 고쳐 쓸 것을 전제로 한다.
> 형식이 맞고 테스트가 통과하는 것이 이 단계의 목표다.

`curriculum/cs.yaml`:

```yaml
subject: cs
label: 컴퓨터 과학
days:
  - day: 1
    topic: 프로세스와 스레드
    goal: 컨텍스트 스위칭 비용이 왜 발생하는지 설명할 수 있다
    keywords: [PCB, 컨텍스트 스위칭, 주소공간, TCB]
    difficulty: 2
  - day: 2
    topic: 뮤텍스와 세마포어
    goal: 두 동기화 도구의 소유권 개념 차이를 구분한다
    keywords: [상호배제, 카운팅 세마포어, 데드락]
    difficulty: 3
  - day: 3
    topic: 가상 메모리와 페이징
    goal: 페이지 폴트가 발생했을 때 OS가 하는 일을 순서대로 말할 수 있다
    keywords: [페이지 테이블, TLB, 페이지 폴트, 스와핑]
    difficulty: 3
  - day: 4
    topic: TCP 연결 수립과 종료
    goal: 3-way handshake 의 각 단계가 무엇을 보장하는지 설명한다
    keywords: [SYN, ACK, TIME_WAIT, 시퀀스 번호]
    difficulty: 2
  - day: 5
    topic: HTTP 캐시
    goal: ETag 와 Cache-Control 이 각각 어떤 문제를 푸는지 구분한다
    keywords: [ETag, max-age, 조건부 요청, "304"]  # 따옴표 필수 — YAML이 숫자로 읽는다
    difficulty: 2
  - day: 6
    topic: 데이터베이스 인덱스
    goal: B-tree 인덱스가 어떤 쿼리에 안 먹는지 이유와 함께 말할 수 있다
    keywords: [B-tree, 복합 인덱스, 선행 컬럼, 카디널리티]
    difficulty: 3
  - day: 7
    topic: 트랜잭션 격리 수준
    goal: 각 격리 수준에서 어떤 이상 현상이 허용되는지 대응시킨다
    keywords: [더티 리드, 팬텀 리드, MVCC, 직렬화 가능]
    difficulty: 4
```

`curriculum/english.yaml`:

```yaml
subject: english
label: 영어
days:
  - day: 1
    topic: 가정법 과거와 과거완료
    goal: 두 시제가 가리키는 시점 차이를 예문으로 구분한다
    keywords: [if절, would have, 시제 일치, 반사실]
    difficulty: 3
  - day: 2
    topic: 관계대명사의 제한적 용법과 계속적 용법
    goal: 쉼표 유무가 의미를 어떻게 바꾸는지 설명한다
    keywords: [which, that, 계속적 용법, 선행사]
    difficulty: 2
  - day: 3
    topic: 분사구문
    goal: 부사절을 분사구문으로 바꾸고 원래 접속사의 의미를 복원한다
    keywords: [현재분사, 완료분사, 의미상 주어, 독립분사구문]
    difficulty: 3
  - day: 4
    topic: 조동사의 추측 표현
    goal: must / may / might / could 의 확신 강도를 순서대로 배열한다
    keywords: [추측, 확신도, must have p.p., 과거 추측]
    difficulty: 2
  - day: 5
    topic: 수동태를 쓰는 이유
    goal: 능동태 대신 수동태를 선택해야 하는 상황 세 가지를 든다
    keywords: [행위자 생략, 정보 구조, by구, 학술 문체]
    difficulty: 2
  - day: 6
    topic: 관사 a / the / 무관사
    goal: 첫 언급과 재언급에서 관사가 바뀌는 규칙을 적용한다
    keywords: [한정성, 총칭 용법, 불가산명사, 고유명사]
    difficulty: 4
  - day: 7
    topic: 전치사 in / on / at 의 공간과 시간
    goal: 세 전치사의 공간 은유가 시간 표현으로 확장되는 방식을 설명한다
    keywords: [점, 면, 공간, 은유적 확장]
    difficulty: 2
```

`curriculum/math.yaml`:

> **주의:** 스펙 §5.8에 따라 수학의 `goal`은 계산이 아니라 **개념·서술**로 잡는다.
> `gpt-4o-mini`는 계산이 틀린 문제를 자신 있게 내고 루브릭까지 틀리면 정답을 오답 처리한다.

```yaml
subject: math
label: 수학
days:
  - day: 1
    topic: 극한의 엄밀한 정의
    goal: 엡실론-델타 정의가 "가까워진다"는 직관을 어떻게 형식화하는지 설명한다
    keywords: [엡실론-델타, 수렴, 근방, 임의의]
    difficulty: 4
  - day: 2
    topic: 미분계수와 접선
    goal: 미분 가능성이 연속성보다 강한 조건인 이유를 반례로 보인다
    keywords: [평균변화율, 순간변화율, 절댓값 함수, 좌미분계수]
    difficulty: 3
  - day: 3
    topic: 연쇄법칙
    goal: 연쇄법칙이 왜 곱의 형태가 되는지 변화율의 합성으로 설명한다
    keywords: [합성함수, 변화율, 치환, 미분 연산자]
    difficulty: 3
  - day: 4
    topic: 정적분과 넓이
    goal: 리만 합의 극한이 왜 넓이와 같아지는지 설명한다
    keywords: [리만 합, 분할, 상합과 하합, 적분 가능]
    difficulty: 4
  - day: 5
    topic: 미적분학의 기본정리
    goal: 미분과 적분이 역연산이라는 주장이 무엇을 의미하는지 서술한다
    keywords: [원시함수, 누적함수, 제1기본정리, 제2기본정리]
    difficulty: 4
  - day: 6
    topic: 벡터의 내적
    goal: 내적이 왜 두 벡터의 "정렬 정도"를 재는지 기하적으로 설명한다
    keywords: [코사인, 정사영, 직교, 성분 표현]
    difficulty: 2
  - day: 7
    topic: 행렬식의 의미
    goal: 행렬식의 부호와 크기가 각각 무엇을 뜻하는지 넓이 변화로 설명한다
    keywords: [선형변환, 넓이 배율, 방향 반전, 특이행렬]
    difficulty: 3
```

- [x] **Step 7: 테스트 통과 확인**

Run: `npm test -- tests/curriculum.test.ts`
Expected: PASS (8 tests)

- [x] **Step 8: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/curriculum
git add -A
git commit -m "feat: 커리큘럼 zod 스키마와 로더, Day 1~7 초안

커리큘럼은 DB가 아니라 레포의 YAML이다. PR로 고치고 롤백된다.
day 번호가 1부터 연속인지 검증해 형식 오류가 배포 전에 잡히게 한다.

수학은 스펙 §5.8에 따라 goal 을 계산이 아니라 개념·서술로 잡았다.
내용은 초안이며 이후 PR에서 다듬는다."
```

---

## Task 5: 세션 저장소

**Files:**
- Create: `lib/session/store.ts`, `lib/session/postgres.ts`
- Test: `tests/session/store.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `Clock` (Task 3), `createTestDb` (Task 2), `fixedClock` (Task 3)
- Produces:
  - `lib/session/store.ts` → `IDLE_TTL_MS`, `ABSOLUTE_TTL_MS`, `interface Session`, `interface SessionStore`
  - `lib/session/postgres.ts` → `class PostgresSessionStore implements SessionStore`, `hashToken(token: string): string`

- [x] **Step 1: 인터페이스 작성**

`lib/session/store.ts`:

```ts
export const IDLE_TTL_MS = 15 * 60 * 1000        // 유휴 15분
export const ABSOLUTE_TTL_MS = 2 * 60 * 60 * 1000 // 절대 2시간

export interface Session {
  tokenHash: string
  createdAt: Date
  idleExpiresAt: Date
  expiresAt: Date
}

export interface SessionStore {
  /** 새 세션을 만들고 원본 토큰을 준다. 원본은 DB에 저장되지 않는다. */
  create(): Promise<{ token: string; expiresAt: Date }>
  /** 유효하면 유휴 만료를 밀고 세션을 준다. 무효하면 null. */
  verifyAndTouch(token: string): Promise<Session | null>
  /** 즉시 무효화한다. 없는 토큰이어도 조용히 성공한다. */
  revoke(token: string): Promise<void>
}
```

- [x] **Step 2: 실패하는 테스트 작성**

`tests/session/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore, hashToken } from '../../lib/session/postgres'
import { IDLE_TTL_MS, ABSOLUTE_TTL_MS } from '../../lib/session/store'
import { sessions } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let store: PostgresSessionStore

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
  store = new PostgresSessionStore(db, clock)
})
afterEach(async () => { await close() })

describe('세션 발급', () => {
  it('원본 토큰이 DB에 저장되지 않는다 — 해시만 저장한다', async () => {
    const { token } = await store.create()
    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(token)
    expect(rows[0].tokenHash).toBe(hashToken(token))
  })

  it('매번 다른 토큰을 준다', async () => {
    const a = await store.create()
    const b = await store.create()
    expect(a.token).not.toBe(b.token)
  })
})

describe('세션 검증 — 통과 경로', () => {
  it('갓 만든 세션은 통과한다', async () => {
    const { token } = await store.create()
    expect(await store.verifyAndTouch(token)).not.toBeNull()
  })

  it('활동할 때마다 유휴 만료가 밀린다', async () => {
    const { token } = await store.create()
    clock.advance(10 * 60 * 1000)              // 10분 경과
    const s = await store.verifyAndTouch(token)
    expect(s!.idleExpiresAt.getTime()).toBe(clock.now().getTime() + IDLE_TTL_MS)

    clock.advance(10 * 60 * 1000)              // 다시 10분 (총 20분)
    expect(await store.verifyAndTouch(token)).not.toBeNull() // 밀렸으므로 살아있다
  })
})

describe('세션 검증 — 차단 경로 4가지', () => {
  it('① 없는 토큰은 막는다', async () => {
    expect(await store.verifyAndTouch('존재하지-않는-토큰')).toBeNull()
  })

  it('② 유휴 15분을 넘기면 막는다 — 자리 비움', async () => {
    const { token } = await store.create()
    clock.advance(IDLE_TTL_MS + 1000)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('③ 절대 2시간을 넘기면 막는다 — 계속 활동해도', async () => {
    const { token } = await store.create()

    // 10분마다 활동하면 유휴 만료(15분)는 계속 밀린다.
    // 하지만 절대 만료는 안 밀리므로 2시간을 넘기는 순간 끊겨야 한다.
    // 반복 횟수를 상수로 계산한다 — 손으로 세면 틀린다 (11회 = 110분 < 2시간)
    const STEP_MS = 10 * 60 * 1000
    const steps = Math.ceil(ABSOLUTE_TTL_MS / STEP_MS) + 1

    for (let i = 0; i < steps; i++) {
      clock.advance(STEP_MS)
      await store.verifyAndTouch(token)
    }

    // 정말 2시간을 넘겼는지 먼저 확인한다 — 안 넘겼는데 통과하면 무의미한 테스트다
    expect(clock.now().getTime()).toBeGreaterThan(
      new Date('2026-09-01T00:00:00Z').getTime() + ABSOLUTE_TTL_MS,
    )
    expect(await store.verifyAndTouch(token)).toBeNull()
  })

  it('④ revoke 하면 즉시 막는다 — 종료 버튼', async () => {
    const { token } = await store.create()
    await store.revoke(token)
    expect(await store.verifyAndTouch(token)).toBeNull()
  })
})

describe('revoke', () => {
  it('없는 토큰을 revoke 해도 던지지 않는다 — sendBeacon 은 중복 도착할 수 있다', async () => {
    await expect(store.revoke('없는-토큰')).resolves.toBeUndefined()
  })
})
```

- [x] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test -- tests/session/store.test.ts`
Expected: FAIL — `Cannot find module '../../lib/session/postgres'`

- [x] **Step 4: 구현**

`lib/session/postgres.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { sessions } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'
import {
  ABSOLUTE_TTL_MS, IDLE_TTL_MS,
  type Session, type SessionStore,
} from './store'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: Db, private readonly clock: Clock) {}

  async create(): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS)

    await this.db.insert(sessions).values({
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      expiresAt,
    })

    return { token, expiresAt }
  }

  /**
   * 검증과 갱신을 한 문장으로 한다.
   * 읽고-판단하고-쓰기가 아니므로 동시 요청에도 레이스가 없다.
   */
  async verifyAndTouch(token: string): Promise<Session | null> {
    const now = this.clock.now()
    const rows = await this.db
      .update(sessions)
      .set({
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      })
      .where(and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),      // 절대 만료
        gt(sessions.idleExpiresAt, now),  // 유휴 만료
      ))
      .returning()

    const row = rows[0]
    if (!row) return null

    return {
      tokenHash: row.tokenHash,
      createdAt: row.createdAt,
      idleExpiresAt: row.idleExpiresAt,
      expiresAt: row.expiresAt,
    }
  }

  async revoke(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.clock.now() })
      .where(eq(sessions.tokenHash, hashToken(token)))
  }
}
```

- [x] **Step 5: 테스트 통과 확인**

Run: `npm test -- tests/session/store.test.ts`
Expected: PASS (9 tests)

Run: `npx tsc --noEmit`
Expected: 에러 0개

- [x] **Step 6: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/session-store
git add -A
git commit -m "feat: 세션 저장소와 만료 4경로

verifyAndTouch 를 UPDATE ... WHERE ... RETURNING 한 문장으로 구현해
검증과 갱신 사이에 레이스가 없게 한다.

차단 4경로(없음/유휴/절대/revoke)를 전부 테스트한다.
Clock 주입으로 sleep 없이 2시간 경과를 검증한다.

SessionStore 인터페이스 뒤에 두어 나중에 Redis 구현체를 추가할 수 있다."
```

---

## Task 6: 인증 — scrypt 해시 + 실패 잠금 + 로그인 라우트

**Files:**
- Create: `lib/auth/password.ts`, `lib/auth/lockout.ts`
- Create: `scripts/hash-password.mjs`
- Create: `app/api/session/route.ts`
- Test: `tests/auth/password.test.ts`, `tests/auth/lockout.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `Clock` (Task 3), `PostgresSessionStore` (Task 5)
- Produces:
  - `lib/auth/password.ts` → `hashPassword(plain: string): string`, `verifyPassword(plain: string, stored: string): boolean`
  - `lib/auth/lockout.ts` → `LOCKOUT_WINDOW_MS`, `LOCKOUT_THRESHOLD`, `isLockedOut(db: Db, clock: Clock): Promise<boolean>`, `recordAttempt(db: Db, clock: Clock, succeeded: boolean, ip: string | null): Promise<void>`
  - `app/api/session/route.ts` → `POST` 핸들러. 성공 시 `sid` 쿠키를 심는다.

> **스펙과의 차이 (의도적):** 스펙 §3.5는 argon2id를 명시했으나 scrypt로 바꾼다.
> argon2 구현체는 네이티브 모듈이라 버셀 서버리스 번들링에서 깨질 위험이 있는 반면,
> `node:crypto`의 `scrypt`는 표준 라이브러리이고 메모리 하드 KDF로서 충분하다.
> 의존성 0개, 배포 위험 0개. 이 결정을 `docs/DECISIONS.md`에 기록한다 (Step 7).

- [x] **Step 1: 실패하는 비밀번호 테스트 작성**

`tests/auth/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../lib/auth/password'

describe('hashPassword', () => {
  it('평문을 포함하지 않는다', () => {
    const stored = hashPassword('내비밀번호1234')
    expect(stored).not.toContain('내비밀번호1234')
  })

  it('같은 비밀번호라도 매번 다른 해시를 만든다 — 솔트', () => {
    expect(hashPassword('같은거')).not.toBe(hashPassword('같은거'))
  })

  it('scrypt 형식이다', () => {
    expect(hashPassword('x')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/)
  })
})

describe('verifyPassword', () => {
  it('맞는 비밀번호를 통과시킨다', () => {
    const stored = hashPassword('올바른비밀번호')
    expect(verifyPassword('올바른비밀번호', stored)).toBe(true)
  })

  it('틀린 비밀번호를 막는다', () => {
    const stored = hashPassword('올바른비밀번호')
    expect(verifyPassword('틀린비밀번호', stored)).toBe(false)
  })

  it('한 글자 차이도 막는다', () => {
    const stored = hashPassword('abcdefg')
    expect(verifyPassword('abcdefh', stored)).toBe(false)
  })

  it('망가진 저장값에 던지지 않고 false 를 준다', () => {
    expect(verifyPassword('아무거나', '쓰레기값')).toBe(false)
    expect(verifyPassword('아무거나', '')).toBe(false)
  })
})
```

- [x] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- tests/auth/password.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 3: 비밀번호 모듈 구현**

`lib/auth/password.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const N = 16384   // CPU/메모리 비용
const r = 8
const p = 1
const KEYLEN = 32

/** 'scrypt$N$r$p$salt$hash' — 파라미터를 함께 저장해 나중에 비용을 올릴 수 있다 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N, r, p })
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [tag, nStr, rStr, pStr, saltB64, hashB64] = stored.split('$')
    if (tag !== 'scrypt') return false

    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    if (expected.length !== KEYLEN) return false

    const actual = scryptSync(plain, salt, KEYLEN, {
      N: Number(nStr), r: Number(rStr), p: Number(pStr),
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
```

`scripts/hash-password.mjs`:

```js
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../lib/auth/password.ts'

const rl = createInterface({ input: process.stdin, output: process.stdout })
const pw = await rl.question('비밀번호: ')
rl.close()
console.log('\nAUTH_PASSWORD_HASH 에 아래 값을 넣으세요:\n')
console.log(hashPassword(pw))
```

`npm install -D tsx` 후 `package.json` 에 추가: `"hash:password": "tsx scripts/hash-password.mjs"`

- [x] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/auth/password.test.ts`
Expected: PASS (7 tests)

- [x] **Step 5: 실패하는 잠금 테스트 작성**

`tests/auth/lockout.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { isLockedOut, recordAttempt, LOCKOUT_THRESHOLD, LOCKOUT_WINDOW_MS } from '../../lib/auth/lockout'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
})
afterEach(async () => { await close() })

async function fail(n: number) {
  for (let i = 0; i < n; i++) await recordAttempt(db, clock, false, '1.2.3.4')
}

describe('isLockedOut', () => {
  it('실패가 없으면 잠기지 않는다', async () => {
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('임계값 직전까지는 잠기지 않는다', async () => {
    await fail(LOCKOUT_THRESHOLD - 1)
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('임계값에 도달하면 잠긴다', async () => {
    await fail(LOCKOUT_THRESHOLD)
    expect(await isLockedOut(db, clock)).toBe(true)
  })

  it('창 밖의 실패는 세지 않는다', async () => {
    await fail(LOCKOUT_THRESHOLD)
    clock.advance(LOCKOUT_WINDOW_MS + 1000)
    expect(await isLockedOut(db, clock)).toBe(false)
  })

  it('성공한 시도는 잠금에 세지 않는다', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await recordAttempt(db, clock, true, '1.2.3.4')
    expect(await isLockedOut(db, clock)).toBe(false)
  })
})
```

- [x] **Step 6: 잠금 모듈 구현**

`lib/auth/lockout.ts`:

```ts
import { and, eq, gte, sql } from 'drizzle-orm'
import { loginAttempts } from '../db/schema'
import type { Db } from '../db/types'
import type { Clock } from '../time'

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT_THRESHOLD = 5

export async function isLockedOut(db: Db, clock: Clock): Promise<boolean> {
  const since = new Date(clock.now().getTime() - LOCKOUT_WINDOW_MS)
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(
      eq(loginAttempts.succeeded, false),
      gte(loginAttempts.attemptedAt, since),
    ))
  return (rows[0]?.n ?? 0) >= LOCKOUT_THRESHOLD
}

export async function recordAttempt(
  db: Db, clock: Clock, succeeded: boolean, ip: string | null,
): Promise<void> {
  await db.insert(loginAttempts).values({
    attemptedAt: clock.now(),
    ip,
    succeeded,
  })
}
```

- [x] **Step 7: 로그인 라우트 구현**

`app/api/session/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { verifyPassword } from '@/lib/auth/password'
import { isLockedOut, recordAttempt } from '@/lib/auth/lockout'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  if (await isLockedOut(db, systemClock)) {
    return NextResponse.json(
      { error: 'LOCKED_OUT', message: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.' },
      { status: 429 },
    )
  }

  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  const stored = process.env.AUTH_PASSWORD_HASH ?? ''

  if (!verifyPassword(password, stored)) {
    await recordAttempt(db, systemClock, false, ip)
    return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 })
  }

  await recordAttempt(db, systemClock, true, ip)

  const store = new PostgresSessionStore(db, systemClock)
  const { token, expiresAt } = await store.create()

  const res = NextResponse.json({ expiresAt: expiresAt.toISOString() })
  res.cookies.set('sid', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
  return res
}
```

- [x] **Step 8: 전체 테스트 통과 확인**

Run: `npm test`
Expected: PASS (여기까지 누적 38 tests)

Run: `npx tsc --noEmit`
Expected: 에러 0개

- [x] **Step 9: 결정 로그 갱신 후 커밋**

`docs/DECISIONS.md` 맨 아래에 추가:

```markdown
---

## 2026-08-31 — argon2id 대신 node:crypto 의 scrypt

스펙 §3.5는 argon2id를 명시했으나 구현 단계에서 scrypt로 바꿨다.

argon2 npm 패키지들은 네이티브 모듈(NAPI)이라 버셀 서버리스 번들링에서
깨질 위험이 있다. `node:crypto`의 `scrypt`는 표준 라이브러리이고 메모리 하드
KDF로서 비밀번호 하나를 지키기에 충분하다. 의존성 0개, 배포 위험 0개.

저장 형식에 파라미터를 함께 넣었다(`scrypt$N$r$p$salt$hash`)므로
나중에 비용을 올려도 기존 해시를 계속 검증할 수 있다.

**되돌리려면:** `lib/auth/password.ts` 두 함수만 교체한다. 호출부는 바뀌지 않는다.
```

```bash
git checkout main && git pull && git checkout -b feat/auth
git add -A
git commit -m "feat: scrypt 비밀번호 검증과 로그인 실패 잠금

사용자가 1명이므로 users 테이블 없이 AUTH_PASSWORD_HASH 환경변수 하나로 인증한다.
평문은 어디에도 저장되지 않으며 비교는 timingSafeEqual 로 한다.

argon2 대신 node:crypto 의 scrypt 를 쓴다 — 네이티브 모듈이 없어
버셀 번들링 위험이 0이다. 근거는 docs/DECISIONS.md 참조.

15분 내 5회 실패 시 잠금. 로그인은 돈이 안 들지만 뚫리면
세션 게이트가 통째로 무의미해진다."
```

---

## Task 7: `withSession()` 가드 + 종료 라우트

**Files:**
- Create: `lib/session/guard.ts`
- Create: `app/api/session/end/route.ts`
- Test: `tests/session/guard.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `Session` (Task 5), `Clock` (Task 3)
- Produces:
  - `lib/session/guard.ts` → `type GuardedHandler`, `makeGuard(store: SessionStore): (h: GuardedHandler) => (req: Request) => Promise<Response>`, `withSession(h: GuardedHandler)`, `readSidCookie(req: Request): string | null`
  - `app/api/session/end/route.ts` → `POST` 핸들러

> `makeGuard`는 테스트에서 가짜 스토어를 주입하기 위해 존재한다.
> `withSession`은 프로덕션 스토어를 미리 묶어둔 편의 함수다.

- [x] **Step 1: 실패하는 테스트 작성**

`tests/session/guard.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore } from '../../lib/session/postgres'
import { makeGuard, readSidCookie } from '../../lib/session/guard'
import { IDLE_TTL_MS } from '../../lib/session/store'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let store: PostgresSessionStore

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
  store = new PostgresSessionStore(db, clock)
})
afterEach(async () => { await close() })

function reqWithToken(token: string | null): Request {
  const headers = new Headers()
  if (token) headers.set('cookie', `sid=${token}; theme=dark`)
  return new Request('http://localhost/api/protected', { method: 'POST', headers })
}

const okHandler = async () => new Response('통과', { status: 200 })

/** 동적 세그먼트가 없는 라우트의 컨텍스트 */
const noCtx = { params: Promise.resolve({}) }

describe('readSidCookie', () => {
  it('여러 쿠키 중 sid 만 꺼낸다', () => {
    expect(readSidCookie(reqWithToken('abc123'))).toBe('abc123')
  })
  it('쿠키가 없으면 null', () => {
    expect(readSidCookie(reqWithToken(null))).toBeNull()
  })
})

describe('가드', () => {
  it('유효한 세션은 핸들러까지 도달한다', async () => {
    const guard = makeGuard(store)
    const { token } = await store.create()
    const res = await guard(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(200)
  })

  it('쿠키가 없으면 401 이고 핸들러가 실행되지 않는다', async () => {
    let ran = false
    const guard = makeGuard(store)
    const res = await guard(async () => { ran = true; return new Response('') })(reqWithToken(null), noCtx)
    expect(res.status).toBe(401)
    expect(ran).toBe(false)
  })

  it('유휴 만료된 세션은 401 이고 쿠키를 지운다', async () => {
    const guard = makeGuard(store)
    const { token } = await store.create()
    clock.advance(IDLE_TTL_MS + 1000)
    const res = await guard(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain('sid=')
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })

  it('revoke 된 세션은 401 — 종료 버튼 뒤에는 통과하지 못한다', async () => {
    const guard = makeGuard(store)
    const { token } = await store.create()
    await store.revoke(token)
    const res = await guard(okHandler)(reqWithToken(token), noCtx)
    expect(res.status).toBe(401)
  })

  it('핸들러에 세션을 넘긴다', async () => {
    const guard = makeGuard(store)
    const { token } = await store.create()
    const res = await guard(async (_req, session) =>
      Response.json({ expiresAt: session.expiresAt.toISOString() }),
    )(reqWithToken(token), noCtx)
    expect(res.status).toBe(200)
    expect((await res.json()).expiresAt).toBe('2026-09-01T02:00:00.000Z')
  })
})
```

- [x] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- tests/session/guard.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 3: 가드 구현**

`lib/session/guard.ts`:

```ts
import { db } from '../db/client'
import { systemClock } from '../time'
import { PostgresSessionStore } from './postgres'
import type { Session, SessionStore } from './store'

/** Next 16 의 라우트 컨텍스트. params 는 Promise 다. */
export interface RouteContext<P = Record<string, string>> {
  params: Promise<P>
}

export type GuardedHandler<P = Record<string, string>> = (
  req: Request,
  session: Session,
  ctx: RouteContext<P>,
) => Promise<Response>

export function readSidCookie(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    // 이름은 정확히 'sid' 여야 한다. 'not_sid' 를 잘라 붙여 착각하면 안 된다.
    if (trimmed.slice(0, eq) !== 'sid') continue
    // 값에 '=' 가 있을 수 있다(base64url 패딩). 첫 '=' 뒤 전부가 값이다.
    return trimmed.slice(eq + 1) || null
  }
  return null
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: 'SESSION_EXPIRED', message: '세션이 만료되었습니다. 다시 로그인하세요.' }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        // 죽은 쿠키를 남겨두지 않는다 — 다음 요청이 헛되이 DB를 때린다
        'set-cookie': 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    },
  )
}

/**
 * 스토어를 주입받는 가드 팩토리. 테스트가 이걸 쓴다.
 * ctx 를 핸들러까지 그대로 넘긴다 — 동적 라우트의 params 가 여기 들어 있다.
 */
export function makeGuard(store: SessionStore) {
  return <P>(handler: GuardedHandler<P>) =>
    async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
      const token = readSidCookie(req)
      if (!token) return unauthorized()

      const session = await store.verifyAndTouch(token)
      if (!session) return unauthorized()

      return handler(req, session, ctx)
    }
}

/** 프로덕션 스토어가 묶인 가드. 라우트가 이걸 쓴다. */
export const withSession = makeGuard(new PostgresSessionStore(db, systemClock))
```

- [x] **Step 4: 종료 라우트 구현**

`app/api/session/end/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { readSidCookie } from '@/lib/session/guard'

/**
 * 종료 버튼과 pagehide 의 sendBeacon 이 함께 쓴다.
 * beacon 은 중복 도착하거나 아예 안 올 수 있으므로 멱등하고 항상 204 를 준다.
 * 브라우저 닫힘은 보장되지 않으며, 확실한 안전망은 유휴 15분 타임아웃이다.
 */
export async function POST(req: NextRequest) {
  const token = readSidCookie(req)
  if (token) {
    await new PostgresSessionStore(db, systemClock).revoke(token)
  }

  const res = new NextResponse(null, { status: 204 })
  res.cookies.set('sid', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
```

- [x] **Step 5: 테스트 통과 확인**

Run: `npm test -- tests/session/guard.test.ts`
Expected: PASS (7 tests)

- [x] **Step 6: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/session-guard
git add -A
git commit -m "feat: withSession 가드와 세션 종료 라우트

모든 보호 라우트가 지나는 단일 입구를 만든다.
401 을 줄 때 죽은 쿠키를 함께 지워 다음 요청이 헛되이 DB를 때리지 않게 한다.

종료 라우트는 버튼과 sendBeacon 이 공유한다.
beacon 은 중복 도착하거나 아예 안 올 수 있으므로 멱등하게 만들고
항상 204 를 준다."
```

---

## Task 8: 예산 예약 · 롤백 · 사용량 기록

**Files:**
- Create: `lib/budget/caps.ts`, `lib/budget/reserve.ts`
- Test: `tests/budget/reserve.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `Clock`, `kstToday`, `kstMonth` (Task 3)
- Produces:
  - `lib/budget/caps.ts` → `dailyCallCap(): number`, `monthlyCostCapMicros(): number`
  - `lib/budget/reserve.ts` → `type Reservation = { periodKeys: string[] }`, `reserve(db, clock): Promise<Reservation | null>`, `rollback(db, r: Reservation): Promise<void>`, `recordUsage(db, clock, entry): Promise<void>`

- [x] **Step 1: 캡 모듈 구현**

`lib/budget/caps.ts`:

```ts
/**
 * Preview/Local 의 캡을 낮게 두는 것이 중요하다.
 * 버셀은 PR마다 Preview 배포를 만들고, 개발 중 루프 버그는 흔하다.
 */
export function dailyCallCap(): number {
  return process.env.APP_ENV === 'production' ? 20 : 3
}

/** 월 비용 상한. USD × 1,000,000. 부동소수를 쓰지 않는다. */
export function monthlyCostCapMicros(): number {
  return process.env.APP_ENV === 'production' ? 3_000_000 : 500_000 // $3.00 / $0.50
}
```

- [x] **Step 2: 실패하는 테스트 작성**

`tests/budget/reserve.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { reserve, rollback, recordUsage } from '../../lib/budget/reserve'
import { budgetCounters, usageLedger } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')  // KST 2026-09-01 10:00
  vi.stubEnv('APP_ENV', 'local')              // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

describe('reserve', () => {
  it('캡 이내면 예약을 준다', async () => {
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('캡을 넘으면 null 을 준다 — 호출자는 LLM 을 부르지 않는다', async () => {
    for (let i = 0; i < 3; i++) expect(await reserve(db, clock)).not.toBeNull()
    expect(await reserve(db, clock)).toBeNull()
  })

  it('동시 요청 10개가 캡 3에서 정확히 3번만 통과한다', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(db, clock)))
    expect(results.filter((r) => r !== null)).toHaveLength(3)
  })

  it('날짜가 바뀌면 일일 카운터가 리셋된다', async () => {
    for (let i = 0; i < 3; i++) await reserve(db, clock)
    expect(await reserve(db, clock)).toBeNull()

    clock.advance(24 * 60 * 60 * 1000)
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('KST 자정 경계에서 리셋된다 — UTC 가 아니라', async () => {
    const utcAfternoon = fixedClock('2026-09-01T14:59:00Z')  // KST 23:59
    for (let i = 0; i < 3; i++) await reserve(db, utcAfternoon)
    expect(await reserve(db, utcAfternoon)).toBeNull()

    const justAfterKstMidnight = fixedClock('2026-09-01T15:01:00Z') // KST 다음날 00:01
    expect(await reserve(db, justAfterKstMidnight)).not.toBeNull()
  })

  it('일일과 월간 두 카운터를 함께 올린다', async () => {
    const r = await reserve(db, clock)
    expect(r!.periodKeys).toEqual(['day:2026-09-01', 'month:2026-09'])

    const rows = await db.select().from(budgetCounters)
    expect(rows).toHaveLength(2)
    expect(rows.every((x) => x.calls === 1)).toBe(true)
  })
})

describe('rollback', () => {
  it('호출 실패 시 예약을 되돌려 캡을 낭비하지 않는다', async () => {
    const r = await reserve(db, clock)
    await rollback(db, r!)

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(0)
  })

  it('롤백하면 다시 예약할 수 있다', async () => {
    for (let i = 0; i < 3; i++) await reserve(db, clock)
    expect(await reserve(db, clock)).toBeNull()

    await rollback(db, { periodKeys: ['day:2026-09-01', 'month:2026-09'] })
    expect(await reserve(db, clock)).not.toBeNull()
  })

  it('0 밑으로 내려가지 않는다', async () => {
    const r = { periodKeys: ['day:2026-09-01', 'month:2026-09'] }
    await reserve(db, clock)
    await rollback(db, r)
    await rollback(db, r)

    const [day] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'day:2026-09-01'))
    expect(day.calls).toBe(0)
  })
})

describe('recordUsage', () => {
  it('원장에 남기고 월간 비용 카운터를 올린다', async () => {
    await reserve(db, clock)
    await recordUsage(db, clock, {
      route: 'content', subject: 'cs', model: 'gpt-4o-mini',
      promptTokens: 800, completionTokens: 1200, costMicros: 840, ok: true,
    })

    const ledger = await db.select().from(usageLedger)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].costMicros).toBe(840)

    const [month] = await db.select().from(budgetCounters)
      .where(eq(budgetCounters.periodKey, 'month:2026-09'))
    expect(month.costMicros).toBe(840)
  })
})
```

- [x] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test -- tests/budget/reserve.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 4: 구현**

`lib/budget/reserve.ts`:

```ts
import { and, eq, lt, sql } from 'drizzle-orm'
import { budgetCounters, usageLedger } from '../db/schema'
import type { Db } from '../db/types'
import { kstMonth, kstToday, type Clock } from '../time'
import { dailyCallCap, monthlyCostCapMicros } from './caps'

export interface Reservation {
  periodKeys: string[]
}

export interface UsageEntry {
  route: string
  subject: string | null
  model: string
  promptTokens: number | null
  completionTokens: number | null
  costMicros: number
  ok: boolean
}

/** 일일 캡은 호출 수로, 월간 캡은 비용으로 건다. 월간 호출 수는 넉넉히 잡는다. */
const MONTHLY_CALL_CAP = 100_000

/**
 * 원자적으로 한 칸을 예약한다.
 * null 이면 호출자는 LLM 을 호출하지 않고 429 를 반환해야 한다.
 *
 * 각 UPDATE 는 한 문장이므로 읽고-판단하고-쓰기 사이의 레이스가 없다.
 * 첫 키에서 통과하고 둘째 키에서 막히면 첫 키를 되돌린다.
 */
export async function reserve(db: Db, clock: Clock): Promise<Reservation | null> {
  const now = clock.now()
  const plan = [
    { key: `day:${kstToday(now)}`,   capCalls: dailyCallCap(),   capMicros: monthlyCostCapMicros() },
    { key: `month:${kstMonth(now)}`, capCalls: MONTHLY_CALL_CAP, capMicros: monthlyCostCapMicros() },
  ]

  const taken: string[] = []

  for (const { key, capCalls, capMicros } of plan) {
    await db.insert(budgetCounters)
      .values({ periodKey: key, capCalls, capMicros })
      .onConflictDoNothing()

    // UPDATE ... WHERE calls < cap RETURNING — 한 문장이므로 레이스가 없다.
    // 캡에 걸리면 0행이 돌아온다.
    const updated = await db
      .update(budgetCounters)
      .set({ calls: sql`${budgetCounters.calls} + 1` })
      .where(and(
        eq(budgetCounters.periodKey, key),
        lt(budgetCounters.calls, budgetCounters.capCalls),
        lt(budgetCounters.costMicros, budgetCounters.capMicros),
      ))
      .returning({ calls: budgetCounters.calls })

    if (updated.length === 0) {
      if (taken.length > 0) await rollback(db, { periodKeys: taken })
      return null
    }
    taken.push(key)
  }

  return { periodKeys: taken }
}

/** LLM 호출이 실패했을 때 예약을 되돌린다. 캡을 헛되이 소모하지 않기 위함이다. */
export async function rollback(db: Db, reservation: Reservation): Promise<void> {
  for (const key of reservation.periodKeys) {
    await db
      .update(budgetCounters)
      .set({ calls: sql`GREATEST(${budgetCounters.calls} - 1, 0)` })
      .where(eq(budgetCounters.periodKey, key))
  }
}

/** 호출이 끝난 뒤 실제 토큰과 비용을 기록한다. 캡 재조정의 근거가 된다. */
export async function recordUsage(db: Db, clock: Clock, entry: UsageEntry): Promise<void> {
  const now = clock.now()

  await db.insert(usageLedger).values({
    createdAt: now,
    route: entry.route,
    subject: entry.subject,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    costMicros: entry.costMicros,
    ok: entry.ok,
  })

  await db
    .update(budgetCounters)
    .set({ costMicros: sql`${budgetCounters.costMicros} + ${entry.costMicros}` })
    .where(eq(budgetCounters.periodKey, `month:${kstMonth(now)}`))
}
```

- [x] **Step 5: 테스트 통과 확인**

Run: `npm test -- tests/budget/reserve.test.ts`
Expected: PASS (10 tests)

"동시 요청 10개" 테스트가 불안정하면 예약이 정말 한 문장인지 확인한다.
`select`로 현재값을 읽고 `update`로 쓰는 형태면 그 사이에 레이스가 생긴다 —
반드시 `UPDATE ... WHERE calls < cap ... RETURNING` 한 문장이어야 한다.

**이 테스트가 진짜인지 한 번 확인할 것.** 예약을 일부러 `select` 후 `update` 로
바꿔 돌려보고 실패하는지 본다. 실패하지 않으면 테스트가 아무것도 증명하지 않는 것이다.
(실제로 해봤고 racy 구현에서는 10개가 전부 통과해 테스트가 실패했다)

- [x] **Step 6: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/budget
git add -A
git commit -m "feat: 원자적 예산 예약과 사용량 원장

폭주 루프에 대한 방어선이다. UPDATE ... WHERE calls < cap RETURNING 한 문장이라
동시 요청 10개가 캡 3에서 정확히 3번만 통과한다.

기간 키는 KST 기준이다. UTC 로 잡으면 한국 시간 아침 9시에 캡이 리셋된다.

Preview/Local 캡을 3으로 낮게 둔다. 버셀은 PR마다 Preview 를 만들고
개발 중 루프 버그는 흔하다."
```

---

## Task 9: 가짜 LLM 클라이언트 + 4겹이 전부 붙은 라우트

**Files:**
- Create: `lib/llm/types.ts`, `lib/llm/fake.ts`
- Create: `app/api/study/[subject]/content/route.ts`
- Test: `tests/integration/content-route.test.ts`

**Interfaces:**
- Consumes: 전부 (Task 2·3·4·5·7·8)
- Produces:
  - `lib/llm/types.ts` → `interface LlmResult`, `interface LlmClient`
  - `lib/llm/fake.ts` → `class FakeLlmClient implements LlmClient` (`calls` 카운터 노출)
  - `lib/study/content.ts` → `getOrCreateContent(deps, subject, dayNo): Promise<ContentOutcome>`

> 라우트 파일 자체는 얇게 두고, 4겹이 붙는 로직은 `lib/study/content.ts`의
> 순수 함수로 뺀다. 그래야 Next.js 런타임 없이 테스트할 수 있다.

- [x] **Step 1: LLM 인터페이스 작성**

`lib/llm/types.ts`:

```ts
export interface LlmResult<T> {
  data: T
  promptTokens: number
  completionTokens: number
  costMicros: number
}

export interface LlmClient {
  /**
   * 스키마에 맞는 JSON 을 생성한다.
   * 2주차에 OpenAI Structured Outputs 로 구현한다. 1주차에는 FakeLlmClient 만 존재한다.
   */
  generate<T>(args: {
    route: string
    system: string
    user: string
    schemaName: string
    maxTokens: number
    temperature: number
  }): Promise<LlmResult<T>>
}
```

`lib/llm/fake.ts`:

```ts
import type { LlmClient, LlmResult } from './types'

/**
 * 1주차의 유일한 LlmClient 구현체.
 * 호출 횟수를 세어 "멱등성 덕분에 호출이 1회였다"를 테스트가 증명할 수 있게 한다.
 */
export class FakeLlmClient implements LlmClient {
  calls = 0

  constructor(private readonly payload: unknown = { passage: { title: '가짜 지문', body_md: '본문' }, questions: [] }) {}

  async generate<T>(): Promise<LlmResult<T>> {
    this.calls += 1
    return {
      data: this.payload as T,
      promptTokens: 800,
      completionTokens: 1200,
      costMicros: 840,
    }
  }
}
```

- [x] **Step 2: 실패하는 통합 테스트 작성**

`tests/integration/content-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { FakeLlmClient } from '../../lib/llm/fake'
import { getOrCreateContent } from '../../lib/study/content'
import { studyDays } from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let llm: FakeLlmClient

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T01:00:00Z')   // KST 2026-09-01
  llm = new FakeLlmClient()
  vi.stubEnv('APP_ENV', 'local')               // 일일 캡 3
})
afterEach(async () => { await close(); vi.unstubAllEnvs() })

const deps = () => ({ db, clock, llm })

describe('멱등성 — ②겹', () => {
  it('첫 요청에 LLM 을 1회 호출한다', async () => {
    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(out.status).toBe('ok')
    expect(llm.calls).toBe(1)
  })

  it('같은 Day 를 10번 요청해도 LLM 호출은 1회다 — 새로고침 폭탄 방어', async () => {
    for (let i = 0; i < 10; i++) await getOrCreateContent(deps(), 'cs', 1)
    expect(llm.calls).toBe(1)
    expect(await db.select().from(studyDays)).toHaveLength(1)
  })

  it('캐시 히트는 예산을 소모하지 않는다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)          // 예산 1 소모
    for (let i = 0; i < 20; i++) await getOrCreateContent(deps(), 'cs', 1)
    expect(llm.calls).toBe(1)                           // 캡 3을 넘겼는데도 통과
  })
})

describe('예산 캡 — ③겹', () => {
  it('캡을 넘으면 LLM 을 호출하지 않고 cap_exceeded 를 준다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    await getOrCreateContent(deps(), 'english', 1)
    await getOrCreateContent(deps(), 'math', 1)
    expect(llm.calls).toBe(3)

    // 주의: clock.advance 로 하루를 넘기면 일일 카운터도 리셋되므로 캡 테스트가 안 된다.
    // 예산을 직접 소진시킨 뒤 요청해야 한다.
    const out = await getOrCreateContent(deps(), 'cs', 2)
    expect(out.status).toBe('cap_exceeded')
    expect(llm.calls).toBe(3)            // 늘지 않았다
  })
})

describe('당일 추가 생성 없음 — ②겹', () => {
  it('같은 과목의 다른 Day 를 같은 날 시작할 수 없다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const out = await getOrCreateContent(deps(), 'cs', 2)
    expect(out.status).toBe('already_studied_today')
    expect(llm.calls).toBe(1)
  })

  it('다른 과목은 같은 날 시작할 수 있다', async () => {
    await getOrCreateContent(deps(), 'cs', 1)
    const out = await getOrCreateContent(deps(), 'math', 1)
    expect(out.status).toBe('ok')
    expect(llm.calls).toBe(2)
  })
})

describe('루브릭 유출 방지', () => {
  it('expected_points 와 hint 가 응답에 섞여 나가지 않는다', async () => {
    llm = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [{
        id: 'q1', type: 'concept', prompt: '설명하라',
        expected_points: ['비밀 루브릭'], hint: '비밀 힌트',
      }],
    })
    const out = await getOrCreateContent(deps(), 'cs', 1)
    expect(out.status).toBe('ok')

    const json = JSON.stringify(out.content)
    expect(json).not.toContain('expected_points')
    expect(json).not.toContain('비밀 루브릭')
    expect(json).not.toContain('비밀 힌트')
  })

  it('루브릭은 DB 에는 남아 있다 — 채점이 써야 한다', async () => {
    llm = new FakeLlmClient({
      passage: { title: '제목', body_md: '본문', key_terms: [] },
      questions: [{ id: 'q1', type: 'concept', prompt: 'p', expected_points: ['보존됨'], hint: 'h' }],
    })
    await getOrCreateContent(deps(), 'cs', 1)

    const [row] = await db.select().from(studyDays)
    expect(JSON.stringify(row.content)).toContain('보존됨')
  })
})

describe('없는 Day', () => {
  it('커리큘럼에 없는 Day 는 LLM 을 호출하지 않는다', async () => {
    const out = await getOrCreateContent(deps(), 'cs', 9999)
    expect(out.status).toBe('no_such_day')
    expect(llm.calls).toBe(0)
  })
})
```

- [x] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test -- tests/integration/content-route.test.ts`
Expected: FAIL — `lib/study/content` 없음

- [x] **Step 4: 구현**

`lib/study/content.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { studyDays } from '../db/schema'
import type { Db } from '../db/types'
import { kstToday, type Clock } from '../time'
import { getDay, type Subject } from '../curriculum/load'
import { recordUsage, reserve, rollback } from '../budget/reserve'
import type { LlmClient } from '../llm/types'

export interface ContentDeps {
  db: Db
  clock: Clock
  llm: LlmClient
}

/** 클라이언트에 나가는 형태. 루브릭과 힌트가 없다. */
export interface PublicContent {
  passage: unknown
  questions: Array<{ id: string; type: string; prompt: string }>
}

export type ContentOutcome =
  | { status: 'ok'; content: PublicContent }
  | { status: 'no_such_day' }
  | { status: 'already_studied_today' }
  | { status: 'cap_exceeded' }

interface RawQuestion {
  id: string
  type: string
  prompt: string
  expected_points?: string[]
  hint?: string
}

/** 루브릭과 힌트를 벗긴다. 개발자도구로 정답을 미리 볼 수 없게 한다. */
function toPublic(raw: unknown): PublicContent {
  const c = raw as { passage: unknown; questions?: RawQuestion[] }
  return {
    passage: c.passage,
    questions: (c.questions ?? []).map((q) => ({ id: q.id, type: q.type, prompt: q.prompt })),
  }
}

export async function getOrCreateContent(
  deps: ContentDeps, subject: Subject, dayNo: number,
): Promise<ContentOutcome> {
  const { db, clock, llm } = deps

  const entry = getDay(subject, dayNo)
  if (!entry) return { status: 'no_such_day' }

  // ②겹 — 이미 만든 Day 면 LLM 을 부르지 않는다
  const existing = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.dayNo, dayNo)))
  if (existing[0]) return { status: 'ok', content: toPublic(existing[0].content) }

  // ②겹 — 이 과목을 오늘 이미 했으면 새 Day 를 열지 않는다
  const today = kstToday(clock.now())
  const todays = await db.select().from(studyDays)
    .where(and(eq(studyDays.subject, subject), eq(studyDays.studyDate, today)))
  if (todays[0]) return { status: 'already_studied_today' }

  // ③겹 — 예산을 먼저 확보한다. 실패하면 LLM 을 부르지 않는다
  const reservation = await reserve(db, clock)
  if (!reservation) return { status: 'cap_exceeded' }

  let result
  try {
    result = await llm.generate<unknown>({
      route: 'content',
      system: '(2주차에 실제 프롬프트를 넣는다 — 스펙 §5.4)',
      user: `과목: ${subject}\nDay: ${entry.day}\n주제: ${entry.topic}\n목표(goal): ${entry.goal}\n키워드: ${entry.keywords.join(', ')}\n난이도: ${entry.difficulty} / 5`,
      schemaName: 'study_content',
      maxTokens: 2000,
      temperature: 0.6,
    })
  } catch (err) {
    await rollback(db, reservation)
    await recordUsage(db, clock, {
      route: 'content', subject, model: 'fake',
      promptTokens: null, completionTokens: null, costMicros: 0, ok: false,
    })
    throw err
  }

  await recordUsage(db, clock, {
    route: 'content', subject, model: 'fake',
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros: result.costMicros,
    ok: true,
  })

  // 루브릭을 포함한 원본을 저장한다. ON CONFLICT 로 동시 요청 한 쪽만 살린다
  await db.insert(studyDays)
    .values({ subject, dayNo, studyDate: today, content: result.data as object })
    .onConflictDoNothing()

  return { status: 'ok', content: toPublic(result.data) }
}
```

`app/api/study/[subject]/content/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { withSession } from '@/lib/session/guard'
import { FakeLlmClient } from '@/lib/llm/fake'
import { getOrCreateContent } from '@/lib/study/content'
import { SUBJECTS, type Subject } from '@/lib/curriculum/schema'

// 1주차에는 가짜 클라이언트만 존재한다. 2주차에 OpenAiLlmClient 로 교체한다.
const llm = new FakeLlmClient()

const STATUS_CODE: Record<string, number> = {
  no_such_day: 404,
  already_studied_today: 409,
  cap_exceeded: 429,
}

export const POST = withSession<{ subject: string }>(async (req, _session, ctx) => {
  // Next 16 에서 params 는 Promise 다. URL 문자열을 자르지 않는다.
  const { subject } = await ctx.params
  if (!SUBJECTS.includes(subject as Subject)) {
    return NextResponse.json({ error: 'UNKNOWN_SUBJECT' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const dayNo = Number(body?.dayNo)
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    return NextResponse.json({ error: 'INVALID_DAY' }, { status: 400 })
  }

  const outcome = await getOrCreateContent(
    { db, clock: systemClock, llm }, subject as Subject, dayNo,
  )

  if (outcome.status === 'ok') return NextResponse.json(outcome.content)
  return NextResponse.json({ error: outcome.status.toUpperCase() }, {
    status: STATUS_CODE[outcome.status] ?? 500,
  })
})
```

- [x] **Step 5: 테스트 통과 확인**

Run: `npm test -- tests/integration/content-route.test.ts`
Expected: PASS (9 tests)

Run: `npm test`
Expected: 전체 PASS

Run: `npm run check:secrets`
Expected: `OK — NEXT_PUBLIC_ 없음`

- [x] **Step 6: 커밋**

```bash
git checkout main && git pull && git checkout -b feat/fake-llm
git add -A
git commit -m "feat: 가짜 LLM 클라이언트와 4겹 방어가 붙은 콘텐츠 라우트

FakeLlmClient 가 호출 횟수를 세므로 '같은 Day 를 10번 요청해도 호출 1회'를
테스트가 실제로 증명한다.

로직을 lib/study/content.ts 의 순수 함수로 빼서 Next.js 런타임 없이 테스트한다.
라우트 파일은 얇은 어댑터다.

expected_points 와 hint 가 응답에 섞여 나가지 않는지 검증한다.
DB 에는 남아야 하고 클라이언트에는 나가면 안 된다."
```

---

## Task 9.5: 디자인 캔버스 — 하루 학습 전체 흐름  ✅

**산출물:** 아트보드 7장이 올라간 디자인 캔버스(Artifact). 코드 없음.

**왜 Task 10 앞인가:** Task 10 은 UI 구현 태스크다. 디자인이 먼저 있어야
"동작하는 최소 화면"이 아니라 "의도한 화면"을 구현하게 된다.
2~3주차 화면까지 미리 그려두면 그때는 구현만 하면 되고,
흐름의 어색함(예: 채점 결과에서 정리본으로 넘어가는 지점)도 지금 발견된다.

**아트보드 7장:**

1. 로그인 — 비밀번호 하나. 유휴 15분 안내
2. 대시보드 — 과목 3카드, 각 카드에 진도(Day N / 총 M)와 오늘 상태
3. 학습 — 지문(마크다운 + KaTeX) + 서술형 문제 3개 입력란
4. 채점 결과 — 문제별 맞은/놓친 포인트, 오개념, "이 채점이 틀렸다" 버튼
5. 정리본 작성 — `summary_seed` 를 체크리스트로 띄운 에디터
6. 다듬기 diff 승인 — 원문 / 다듬은 글 나란히, 무엇을 왜 고쳤는지
7. 발행 — Velog 로 보내기 + 클립보드 폴백

**모든 화면에 공통으로 들어가는 것:**

- 상단 세션 바 — 남은 시간 카운트다운, 만료 2분 전 경고, [종료] 버튼
- 429(캡 초과) / 401(세션 만료) 상태의 표시 방법

**진행 방법:** `design` 스킬을 호출해 캔버스를 만든다.
사용자가 캔버스에서 직접 다듬은 뒤 그 결과를 Task 10 이 구현한다.

**완료 기준:** 캔버스 URL 이 나오고, 사용자가 7장을 확인했다.

### 결과 (2026-09-01)

캔버스: https://claude.ai/code/artifact/54e9838d-e75b-47cd-85a2-1e22ff749963

원본 아트보드는 `design/canvas/*.dc.html` 에 있다. **캔버스를 고칠 때는
이 파일들을 고쳐서 다시 씨딩한다.** 발행된 HTML(`study-page-daily-flow.html`)을
직접 편집하지 않는다.

계획의 7장에 **8번째 아트보드 `States`** 를 더했다. 세션 바 4가지 상태와
막힌 화면 4장(429 / 401 / 409 / 423 잠금)을 한 장에 모았다. 원래 "모든
화면에 공통으로 들어가는 것"으로만 적혀 있었는데, 공통 요소는 어느 한
화면에 그리면 그 화면의 것처럼 보인다. 따로 떼어야 Task 10 이 컴포넌트로
구현한다.

**방향:** 조용한 서재 — 따뜻한 종이색 바탕, 세리프 제목, 읽기가 주인공.
지문을 읽고 서술형을 쓰는 게 하루의 대부분이라 그렇게 잡았다.
정적 목업이다(클릭되는 프로토타입 아님).

**Task 10 이 그대로 쓸 토큰:**

| 역할 | 값 |
|---|---|
| 바탕 (paper) | `#FAF7F2` |
| 카드 (surface) | `#FFFDF9` |
| 실선 | `#E7E0D5` · 연함 `#EDE6DA` · 진함 `#D8CFC0` |
| 잉크 (제목·강조) | `#23201C` |
| 본문 | `#3D382F` |
| 흐림 | `#7A7266` · 더 흐림 `#9C948A` · 플레이스홀더 `#C4BAA9` |
| 초록 — 맞음·완료 | `#24765F` (틴트 `#E2EEE8`) |
| 앰버 — 놓침·주의 | `#83682C` (틴트 `#F3ECDB`) |
| 테라코타 — 차단·오류 | `#9A5B42` (틴트 `#F6EDE8`) |

세 상태색은 oklch 에서 L·C 를 맞추고 색상(hue)만 돌린 것이다.
새 상태색이 필요하면 같은 L·C 를 유지한다.

| 역할 | 글꼴 |
|---|---|
| 제목 | `'Gowun Batang', Georgia, 'Times New Roman', serif` |
| 본문 | `'IBM Plex Sans KR', system-ui, sans-serif` |
| 계기판·코드·숫자 | `'IBM Plex Mono', ui-monospace, Menlo, monospace` |

기본 버튼은 잉크 채움(`#23201C` / 글자 `#FAF7F2`), 보조 버튼은
`#D8CFC0` 테두리에 배경 없음. 모서리 반경은 3px(버튼·칩) / 4px(카드).
본문 지문은 17px / 행간 1.8, 화면 폭은 학습·채점 720px, 정리·다듬기 940px,
대시보드 880px, 발행 800px.

**세션 바가 UI 에서 값을 치르는 지점:** 하트비트를 넣지 않기로 했으므로
(`docs/DECISIONS.md`) 만료가 사용자에게 갑작스러운 일이 되면 안 된다.
그래서 바를 3단계로 만들었다 — 정상 / 2분 전 앰버 / 30초 앞 테라코타.
30초 단계에는 "쓰던 답은 브라우저에 남는다"를 명시한다. 이건 안내 문구가
아니라 **Task 10 이 구현해야 하는 동작**이다(로컬 초안 보관).

---

## Task 10: 프론트 — 로그인 · 카운트다운 · 종료

**Files:**
- Create: `app/login/page.tsx`
- Modify: `app/page.tsx` (create-next-app 기본 페이지를 대시보드로 교체)
- Create: `components/SessionBar.tsx`
- Create: `app/api/session/status/route.ts`
- Test: `tests/session/status-route.test.ts`

**Interfaces:**
- Consumes: `withSession` (Task 7), `POST /api/session` (Task 6), `POST /api/session/end` (Task 7)
- Produces: `GET /api/session/status` → `{ expiresAt: string; idleExpiresAt: string }`

> 카운트다운은 **서버가 준 만료 시각**을 기준으로 그린다. 클라이언트가 자체 타이머를
> 굴리면 탭이 백그라운드로 가거나 노트북이 잠들 때 어긋난다.

- [x] **Step 1: 상태 라우트 테스트 작성**

`tests/session/status-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/testDb'
import { fixedClock } from '../helpers/clock'
import { PostgresSessionStore } from '../../lib/session/postgres'
import { makeGuard } from '../../lib/session/guard'
import { sessionStatusHandler } from '../../lib/session/status'
import type { Db } from '../../lib/db/types'

let db: Db
let close: () => Promise<void>
let clock: ReturnType<typeof fixedClock>
let store: PostgresSessionStore

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
  clock = fixedClock('2026-09-01T00:00:00Z')
  store = new PostgresSessionStore(db, clock)
})
afterEach(async () => { await close() })

describe('세션 상태', () => {
  it('두 만료 시각을 준다', async () => {
    const { token } = await store.create()
    const req = new Request('http://localhost/api/session/status', {
      headers: { cookie: `sid=${token}` },
    })
    const res = await makeGuard(store)(sessionStatusHandler)(req, { params: Promise.resolve({}) })
    const body = await res.json()

    expect(body.expiresAt).toBe('2026-09-01T02:00:00.000Z')     // 절대 2시간
    expect(body.idleExpiresAt).toBe('2026-09-01T00:15:00.000Z') // 유휴 15분
  })

  it('세션이 없으면 401 이다 — 카운트다운을 그릴 근거가 없다', async () => {
    const req = new Request('http://localhost/api/session/status')
    const res = await makeGuard(store)(sessionStatusHandler)(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })
})
```

- [x] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- tests/session/status-route.test.ts`
Expected: FAIL — `lib/session/status` 없음

- [x] **Step 3: 상태 핸들러 구현**

`lib/session/status.ts`:

```ts
import type { GuardedHandler } from './guard'

export const sessionStatusHandler: GuardedHandler = async (_req, session) =>
  Response.json({
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
  })
```

`app/api/session/status/route.ts`:

```ts
import { withSession } from '@/lib/session/guard'
import { sessionStatusHandler } from '@/lib/session/status'

export const GET = withSession(sessionStatusHandler)
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/session/status-route.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: 로그인 화면**

`app/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) { router.push('/'); router.refresh(); return }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'LOCKED_OUT'
        ? '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.'
        : '비밀번호가 틀렸습니다.',
    )
    setPassword('')
    setBusy(false)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold">study page</h1>
      <p className="mb-8 text-sm text-neutral-500">
        로그인해야 학습 세션이 시작됩니다. 15분간 활동이 없으면 자동으로 끊깁니다.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          placeholder="비밀번호"
        />
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-40"
        >
          {busy ? '확인 중…' : '시작'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </main>
  )
}
```

- [x] **Step 6: 세션 바 (카운트다운 · 종료 · beacon)**

`components/SessionBar.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const WARN_BEFORE_MS = 2 * 60 * 1000

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function SessionBar() {
  const router = useRouter()
  const [idleExpiresAt, setIdleExpiresAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)

  // 서버가 준 만료 시각을 기준으로 그린다. 클라이언트가 자체 타이머를 굴리면
  // 탭이 백그라운드로 가거나 노트북이 잠들 때 어긋난다.
  useEffect(() => {
    let cancelled = false
    fetch('/api/session/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        setIdleExpiresAt(new Date(body.idleExpiresAt).getTime())
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (idleExpiresAt === null) return
    const tick = () => setRemaining(idleExpiresAt - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [idleExpiresAt])

  // 탭이 닫힐 때 최선 노력으로 세션을 끊는다.
  // 보장되지 않는다 — 확실한 안전망은 서버의 유휴 15분 타임아웃이다.
  useEffect(() => {
    const onHide = () => { navigator.sendBeacon('/api/session/end') }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  async function end() {
    await fetch('/api/session/end', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  if (idleExpiresAt === null) return null

  const warning = remaining <= WARN_BEFORE_MS

  return (
    <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 text-sm">
      <span className={warning ? 'font-medium text-red-600' : 'text-neutral-500'}>
        {remaining <= 0
          ? '세션이 만료되었습니다'
          : warning
            ? `${format(remaining)} 뒤 자동 종료됩니다`
            : `남은 시간 ${format(remaining)}`}
      </span>
      <button onClick={end} className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100">
        종료
      </button>
    </div>
  )
}
```

- [x] **Step 7: 대시보드**

`app/page.tsx` 전체를 교체:

```tsx
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { db } from '@/lib/db/client'
import { systemClock } from '@/lib/time'
import { PostgresSessionStore } from '@/lib/session/postgres'
import { loadAll } from '@/lib/curriculum/load'
import { SessionBar } from '@/components/SessionBar'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const token = (await cookies()).get('sid')?.value
  const session = token
    ? await new PostgresSessionStore(db, systemClock).verifyAndTouch(token)
    : null
  if (!session) redirect('/login')

  const curriculum = loadAll()

  return (
    <>
      <SessionBar />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-semibold">오늘의 학습</h1>
        <ul className="flex flex-col gap-3">
          {Object.values(curriculum).map((c) => (
            <li key={c.subject} className="rounded-lg border border-neutral-200 p-4">
              <p className="font-medium">{c.label}</p>
              <p className="mt-1 text-sm text-neutral-500">
                커리큘럼 {c.days.length}일치 · 진도 표시는 2주차에 붙인다
              </p>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
```

- [x] **Step 8: 손으로 확인** — 2026-09-01 완료. 여섯 가지 전부 실제 Neon 상대로 확인했고, 그 과정에서 버그 셋을 잡았다 (아래 결과 절).

```bash
npm run hash:password        # 비밀번호를 정하고 출력값을 .env.local 의 AUTH_PASSWORD_HASH 에 넣는다
npm run dev
```

브라우저에서 확인할 것:

1. `/` 접속 → `/login`으로 리다이렉트된다
2. 틀린 비밀번호 → "비밀번호가 틀렸습니다"
3. 틀린 비밀번호 5회 → "로그인 시도가 너무 많습니다"
4. (`login_attempts` 테이블을 비운 뒤) 맞는 비밀번호 → 대시보드, 상단에 `남은 시간 15:00`
5. 13분 기다리면 빨간 글씨로 `2:00 뒤 자동 종료됩니다`
6. [종료] 클릭 → `/login`으로 이동. 뒤로 가기를 눌러도 `/`가 다시 `/login`으로 보낸다

- [x] **Step 9: 전체 검증**

```bash
npm test
npm run check:secrets
npx tsc --noEmit
npm run build
```

Expected: 넷 다 성공. `npm run build`가 실패하면 서버 전용 모듈이
클라이언트 컴포넌트에 새어 들어간 것이다 — `'use client'` 파일에서 `lib/db/*`를
import 하지 않았는지 본다.

- [x] **Step 10: 핸드오프 갱신 후 커밋**

`docs/HANDOFF.md`를 통째로 교체:

```markdown
# 핸드오프

**갱신:** (오늘 날짜) · **브랜치:** `feat/ui-session` · **PR:** 열기 직전

## 지금 상태

1주차 완료. 로그인 · 세션 만료 4경로 · 예산 캡 · 멱등성이 전부 자동 테스트로 증명된다.
**LLM 은 한 번도 호출하지 않았다** — `FakeLlmClient` 만 존재한다.

- 테스트: (개수)개 통과
- `npm run build` 통과

## 바로 다음에 할 일

2주차 계획을 작성한다. 첫 작업은 `lib/llm/client.ts` — OpenAI Structured Outputs.

**시작 전 확인:**
- OpenAI 대시보드 프로젝트 하드 리밋 월 $5 가 걸려 있는가
- `.env.local` 과 버셀 Production 에 `OPENAI_API_KEY` 를 넣는다
- 버셀 Preview 환경변수의 `APP_ENV` 가 `preview` 인가 (캡 3)

## 아직 안 정한 것

- [ ] Neon Preview 브랜치 DB 자동 생성 가능 여부
- [ ] 커리큘럼 Day 1~7 내용 다듬기 (지금은 초안)
- [ ] Velog access token 확보 방법 (4주차)

## 하지 말 것

- `FakeLlmClient` 를 지우지 말 것. 모든 테스트가 이걸 주입해서 돈다.
- 진도 표시를 대시보드에 하드코딩하지 말 것. `study_days` 에서 파생한다.

## 명령어

\`\`\`bash
npm run dev
npm test
npm run check:secrets
npm run db:generate
npm run hash:password
\`\`\`
```

```bash
git checkout main && git pull && git checkout -b feat/ui-session
git add -A
git commit -m "feat: 로그인 화면과 세션 카운트다운

카운트다운은 서버가 준 만료 시각을 기준으로 그린다.
클라이언트가 자체 타이머를 굴리면 탭이 백그라운드로 가거나
노트북이 잠들 때 어긋난다.

pagehide 에서 sendBeacon 으로 세션을 끊되, 이건 최선 노력이다.
확실한 안전망은 서버의 유휴 15분 타임아웃이다.

1주차 완료: LLM 호출 0회로 보안·예산 계층이 전부 테스트로 증명된다."
```

---

### 결과 (2026-09-01)

계획에 적힌 코드는 Task 9.5 이전에 쓴 것이라 회색 Tailwind 자리표시자였다.
디자인이 생겼으므로 **디자인을 구현했다.** 계획 본문의 코드 블록은 남겨 두되
실제 구현은 아래대로다.

| 계획 | 실제 |
|---|---|
| `neutral-*` 유틸리티 | `app/globals.css` 의 `@theme` 토큰 (`bg-paper`, `text-ink`, `text-ok` …) |
| 경고 2단계 (정상 / 2분) | 3단계 (정상 / 2분 앰버 / 30초 테라코타 + [계속하기]) |
| 진도 "2주차에 붙인다" | `lib/study/progress.ts` 로 `study_days` 에서 파생 |
| 사용량 표시 없음 | `loadUsage()` 로 `budget_counters` 에서 읽어 하단에 표시 |
| 단일 로그인 클라이언트 컴포넌트 | 서버 페이지 + `components/LoginForm.tsx` (날짜를 서버가 만든다) |

**새로 만든 것:** `lib/session/status.ts`, `lib/study/progress.ts`,
`lib/time.ts` 의 `kstDateLabel()`, `components/SessionBar.tsx`,
`components/LoginForm.tsx`, `app/login/page.tsx`, `app/api/session/status/route.ts`.
테스트 18개 추가 (138 → 156).

#### 계획에 없던 판단 셋

**1. 상태 라우트를 폴링하지 않는다.** 가드는 통과할 때마다 유휴 만료를 민다.
세션 바가 `/api/session/status` 를 주기적으로 부르면 넣지 않기로 한 하트비트가
뒷문으로 들어와 유휴 타임아웃이 영영 오지 않는다. 그래서 마운트 때 한 번만
부르고, 그 뒤로는 받아온 시각과 로컬 시계의 차이만 1초마다 다시 그린다.
`tests/session/status-route.test.ts` 의 "상태 조회도 유휴 만료를 민다" 가
이 사실을 못박아 둔다 — 폴링을 붙이려는 사람이 먼저 읽으라고.

**2. 다시 묻는 경우는 사용자가 움직였을 때뿐이다.** 2분 전 경고가
"아무 키나 누르면 15분으로 되돌아간다"고 말하는데, 클라이언트가 서버의
갱신을 모르면 그 문구가 거짓이 된다. `keydown`/`pointerdown` 에서
최대 1분에 한 번 다시 동기화한다. **타이머가 아니라 사람이 방아쇠라서
하트비트가 아니다** — 자리를 비우면 요청이 0건이고 세션은 예정대로 닫힌다.

**3. 만료 임박 문구를 화면이 넘긴다.** 디자인의 30초 경고는 "쓰던 답은
브라우저에 남는다"고 했지만 1주차에는 답을 쓰는 화면이 없다. 없는 것을
남는다고 하면 거짓말이다. `SessionBar` 에 `expiringNote` prop 을 뒀고,
2주차의 학습 화면이 초안 보관을 구현하면서 그 문장을 넘긴다.

#### 디자인 쪽을 고친 것 둘

구현하면서 캔버스가 코드와 어긋난 곳이 드러나 캔버스를 고쳤다.

- **로그인 잠금은 423 이 아니라 429 `LOCKED_OUT`.** 캡 초과와 상태 코드가
  같아서 본문의 `error` 필드로만 구분된다. 그 사실을 카드에 적었다.
- **사용량은 원화가 아니라 USD.** 월 상한이 USD 마이크로로 저장돼 있고
  환율을 지어낼 수 없다.

---

#### Step 8 손 확인 결과 (2026-09-01)

여섯 가지 전부 실제 Neon 상대로 확인했다. **그 과정에서 버그 셋이 나왔다 —
테스트 156개가 전부 통과하는 상태에서 앱은 로그인조차 되지 않았다.**

| # | 확인 | 결과 |
|---|---|---|
| 1 | `/` → `/login` | 307 리다이렉트 |
| 2 | 틀린 비밀번호 | 401 `INVALID_PASSWORD` |
| 3 | 5회 실패 → 잠금 | 6회째 429 `LOCKED_OUT` |
| 4 | 맞는 비밀번호 | 대시보드, 진도·사용량 실데이터 |
| 5 | 2분 전 경고 | 앰버 → 30초 앞 테라코타 + [계속하기] → 만료 시 자동 이탈 |
| 6 | [종료] 후 재접근 | `/` 가 307 로 튕김, 세션 `revoked` |
| + | 새로고침 | 세션 살아남음 (`/leaving` → 유예 → 첫 요청이 15분으로 복원) |

5번은 `IDLE_TTL_MS` 를 잠깐 150초로 줄여 확인했고 곧바로 되돌렸다.

**나온 버그 셋** (전부 회귀 테스트로 박음, 156 → 181):

1. **dotenv 가 `$` 를 확장해 비밀번호 해시를 파괴** — 어떤 비밀번호도 통과 못 함
2. **만료 판정을 화면 상태로 해서 무한 리다이렉트** — 카운트다운이 계속 리셋되고
   `/api/session/status` 를 586번 호출 (하트비트를 버그가 만들어냄)
3. **`pagehide` 를 창 닫기 전용으로 착각** — 새로고침이 곧 로그아웃

셋 다 자동 테스트로는 나올 수 없는 종류였다. **1주차의 마지막 관문이
"손으로 한 번 돌려본다"인 이유가 이것이다.**

---

## 1주차 완료 기준

아래가 전부 참이어야 1주차가 끝난 것이다.

- [ ] `npm test` 통과 — 세션 만료 4경로, 예산 캡 동시성, 멱등성, 재시도 상한, 루브릭 유출 방지가 포함되어 있다
- [ ] `npm run check:secrets` 통과 — `NEXT_PUBLIC_` 0개
- [ ] `npx tsc --noEmit` 에러 0개
- [ ] `npm run build` 통과
- [ ] `usage_ledger`에 기록된 `model`이 전부 `'fake'`다 — **실제 LLM 호출 0회의 증거**
- [ ] `.env.local`과 버셀 어디에도 `OPENAI_API_KEY`가 없다
- [ ] OpenAI 대시보드에 프로젝트 하드 리밋 월 $5가 걸려 있다
- [ ] `docs/HANDOFF.md`가 1주차 종료 상태를 반영한다

---

## 자체 점검 결과

**스펙 커버리지** — 1주차 범위(스펙 §10 1주차)의 8개 항목 대응:

| 스펙 항목 | 태스크 |
|---|---|
| 뼈대, Drizzle+Neon, 버셀 연결 | 1, 2 |
| CLAUDE.md · HANDOFF · DECISIONS · PR 템플릿 | 이미 완료 (PR #1), 갱신은 6·10 |
| 스키마 마이그레이션 (§4.3) | 2 |
| 커리큘럼 YAML + zod, Day 1~7 | 4 |
| 로그인 (해시 + 실패 제한) / 세션 발급 / 가드 | 5, 6, 7 |
| 종료 · beacon · 유휴 15분 · 절대 2시간 · 카운트다운 | 5, 7, 10 |
| 예산 예약·롤백 + usage_ledger, 가짜 LLM | 8, 9 |
| check:secrets | 1 |

**1주차 범위 밖으로 남긴 것** (스펙에 있으나 2~4주차에 속함):
`lib/llm/client.ts` 실제 구현, `grade`·`summary`·`polish` 라우트,
`/api/admin/usage`, Velog 발행, 학습 화면 본문.

**스펙과의 의도적 차이 1건:** argon2id → scrypt (Task 6, 근거는 `DECISIONS.md`에 기록).
