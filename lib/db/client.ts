import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import type { Db } from './types'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL 이 설정되지 않았습니다')

export const db = drizzle(url, { schema }) as unknown as Db
