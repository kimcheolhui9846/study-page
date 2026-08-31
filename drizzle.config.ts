import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // generate 에는 필요 없다. push/migrate 를 쓸 때만 실제 값이 필요하다.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config
