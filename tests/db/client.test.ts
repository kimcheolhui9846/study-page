import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

describe('db 클라이언트', () => {
  it('DATABASE_URL 없이도 import 가 성공한다', async () => {
    // Next 빌드는 라우트 모듈을 import 해서 설정을 수집한다.
    // 여기서 던지면 DATABASE_URL 없이는 빌드 자체가 불가능해진다.
    vi.stubEnv('DATABASE_URL', '')
    await expect(import('../../lib/db/client')).resolves.toBeDefined()
  })

  it('DATABASE_URL 없이 사용하면 분명한 메시지로 던진다', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { db } = await import('../../lib/db/client')
    expect(() => db.select()).toThrow(/DATABASE_URL/)
  })
})
