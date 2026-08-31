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
 * 지연 연결이면 빌드는 통과하고, 실제로 쿼리를 날릴 때 분명한 메시지로 실패한다.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    instance ??= connect()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
