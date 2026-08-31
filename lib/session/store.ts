export const IDLE_TTL_MS = 15 * 60 * 1000         // 유휴 15분. 활동마다 밀린다
export const ABSOLUTE_TTL_MS = 2 * 60 * 60 * 1000 // 절대 2시간. 절대 밀리지 않는다

export interface Session {
  tokenHash: string
  createdAt: Date
  idleExpiresAt: Date
  expiresAt: Date
}

/**
 * 세션 저장소.
 *
 * 이 인터페이스가 존재하는 이유는 나중에 Redis 로 갈아끼울 수 있게 하기 위함이다.
 * 지금은 Postgres 구현체 하나뿐이고, 라우트 코드는 이 세 메서드만 안다.
 */
export interface SessionStore {
  /** 새 세션을 만들고 원본 토큰을 준다. 원본은 DB에 저장되지 않는다. */
  create(): Promise<{ token: string; expiresAt: Date }>
  /** 유효하면 유휴 만료를 밀고 세션을 준다. 무효하면 null. */
  verifyAndTouch(token: string): Promise<Session | null>
  /** 즉시 무효화한다. 없는 토큰이어도 조용히 성공한다. */
  revoke(token: string): Promise<void>
}
