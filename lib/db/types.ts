import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'

/** Neon(프로덕션)과 PGlite(테스트)가 모두 만족하는 공통 타입 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
