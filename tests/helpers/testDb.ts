import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from '../../lib/db/schema'
import type { Db } from '../../lib/db/types'

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle')

/**
 * 인메모리 Postgres에 마이그레이션을 적용한 새 DB를 만든다.
 *
 * 진짜 Postgres 엔진이므로 UNIQUE·CHECK 제약과 동시성이 프로덕션과 같은 의미로 동작한다.
 * 외부 DB가 필요 없고 테스트마다 완전히 격리된다.
 */
export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite()

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    throw new Error('drizzle/ 에 마이그레이션이 없습니다. npm run db:generate 를 먼저 실행하세요')
  }

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      if (stmt.trim()) await client.exec(stmt)
    }
  }

  const db = drizzle({ client, schema }) as unknown as Db
  return { db, close: () => client.close() }
}
