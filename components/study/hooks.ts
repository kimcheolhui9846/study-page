'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadText, saveText, studyDraftKey } from '@/lib/study/draft'
import {
  newRequestId, postStudy, stateMessage, type ApiState, type PostResult,
} from '@/lib/study/client-api'

/**
 * 입력칸 하나의 초안. 마운트 후에 읽는다 — 서버 렌더에는 localStorage 가 없고,
 * 초기값으로 읽으면 하이드레이션이 어긋난다 (components/AnswerForm.tsx 와 같은 이유).
 */
export function useDraft(scope: string): [string, (v: string) => void, () => void] {
  const key = studyDraftKey(scope)
  const [value, setValue] = useState('')

  useEffect(() => {
    const saved = loadText(key)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 하이드레이션 뒤 초안 복원. 위 주석 참조
    if (saved) setValue(saved)
  }, [key])

  const update = useCallback((v: string) => { setValue(v); saveText(key, v) }, [key])
  const clear = useCallback(() => { setValue(''); saveText(key, '') }, [key])
  return [value, update, clear]
}

export interface ActionStatus {
  busy: boolean
  state: ApiState | null
  message: string
}

/**
 * 유료 행동 하나. 요청 ID 를 관리한다.
 *
 * - 연결이 끊기면 같은 ID 를 남겨 둔다 → 다시 보내도 서버가 두 번 처리하지 않는다
 * - 그 밖의 결과(성공·실패·예산)면 ID 를 버린다 → 다음 전송은 새 요청이다
 *   (「다시 시도」는 사람의 클릭으로 새 ID 를 만든다 — 자동 재시도는 없다)
 */
export function useStudyAction() {
  const router = useRouter()
  const pendingId = useRef<string | null>(null)
  const [status, setStatus] = useState<ActionStatus>({ busy: false, state: null, message: '' })

  const run = useCallback(async (
    path: string, body: object, opts: { paid?: boolean } = { paid: true },
  ): Promise<PostResult> => {
    let id: string | undefined
    if (opts.paid !== false) {
      pendingId.current ??= newRequestId()
      id = pendingId.current
    }
    setStatus({ busy: true, state: null, message: '' })

    const r = await postStudy(path, body, id)
    if (r.state !== 'network') pendingId.current = null

    setStatus({ busy: false, state: r.state, message: stateMessage(r.state, r.message) })
    // 실패해도 서버가 남긴 것(학습자 메시지·안내)이 있을 수 있으니 다시 읽는다.
    if (r.state !== 'network' && r.state !== 'expired') router.refresh()
    return r
  }, [router])

  const reset = useCallback(() => setStatus({ busy: false, state: null, message: '' }), [])

  return { run, status, reset }
}
