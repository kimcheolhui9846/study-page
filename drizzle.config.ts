import type { Config } from 'drizzle-kit'

// drizzle-kit 은 Next 가 아니므로 `.env.local` 을 자동으로 읽지 않는다.
// Node 20.12+ 의 내장 로더를 쓴다 — 의존성을 늘리지 않기 위해서다.
try {
  process.loadEnvFile('.env.local')
} catch {
  // 파일이 없으면 그냥 넘어간다. db:generate 는 URL 없이도 돈다.
}

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // generate 에는 필요 없다. migrate 를 쓸 때만 실제 값이 필요하다.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config
