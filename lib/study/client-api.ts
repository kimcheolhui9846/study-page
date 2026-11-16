/**
 * 화면용 fetch 래퍼. 브라우저에서만 쓴다.
 *
 * ★ 상태를 구분한다 — 생성 중 · 생성 실패 · 예산 부족 · 인증 만료 · 저장 실패 · 연결 끊김.
 * 어느 경우든 화면은 쓰던 답과 메시지를 지우지 않는다 (호출자의 책임).
 */

export type ApiState =
  | 'ok'
  | 'in-progress'
  | 'budget'
  | 'expired'
  | 'failed'
  | 'save-failed'
  | 'invalid'
  | 'network'

export function classify(status: number, code?: string): ApiState {
  if (status === 0) return 'network'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401) return 'expired'
  if (status === 429) return 'budget'
  if (status === 409 && code === 'IN_PROGRESS') return 'in-progress'
  if (status === 502) return 'failed'
  if (status >= 500) return 'save-failed'
  return 'invalid'
}

const TEXT: Record<Exclude<ApiState, 'ok' | 'invalid'>, string> = {
  'in-progress': '앞서 보낸 같은 요청을 처리하는 중이다. 잠시 뒤 새로고침하라.',
  budget: 'AI 사용 한도를 다 썼다. 쓰던 내용은 그대로 남아 있다.',
  expired: '로그인이 만료됐다. 다시 로그인해도 쓰던 내용은 이 브라우저에 남아 있다.',
  failed: 'AI 응답을 받지 못했다. 「다시 시도」로 새로 요청할 수 있다.',
  'save-failed': '서버에서 저장하지 못했다. 쓰던 내용은 남아 있다.',
  network: '연결이 끊겼다. 같은 요청을 다시 보내도 두 번 처리되지 않는다.',
}

export function stateMessage(state: ApiState, serverMessage?: string): string {
  if (state === 'ok') return ''
  if (state === 'invalid') return serverMessage ?? '요청이 올바르지 않다.'
  return TEXT[state]
}

export interface PostResult {
  state: ApiState
  data?: unknown
  message?: string
  code?: string
}

export async function postStudy(path: string, body: object, requestId?: string): Promise<PostResult> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestId ? { ...body, requestId } : body),
    })
  } catch {
    return { state: 'network' }
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const code = typeof json?.error === 'string' ? json.error : undefined
  const state = classify(res.status, code)
  if (state === 'ok') return { state, data: json }
  return {
    state,
    message: typeof json?.message === 'string' ? json.message : undefined,
    code,
  }
}

/** 전송마다 새 ID. 같은 전송을 다시 보낼 때(연결 끊김)는 이 값을 재사용한다 */
export function newRequestId(): string {
  return crypto.randomUUID()
}
