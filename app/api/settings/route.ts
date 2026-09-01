import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { withSession } from '@/lib/session/guard'
import { SettingsSchema, saveSettings } from '@/lib/settings/store'

/**
 * 설정을 저장한다. **LLM 을 부르지 않는다.**
 *
 * ★ 오늘 계획은 바뀌지 않는다. 하루에 계획 하나라는 규칙(`one_plan_per_date`)이
 * 그날 안에서의 재계산을 막는다. 새 설정은 내일 계획부터 적용된다.
 */
export const POST = withSession(async (req) => {
  const body = await req.json().catch(() => null)

  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    // 무엇이 잘못됐는지 말해준다. 값은 되돌려 보내지 않는다 — 화면이 이미 안다.
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: 'INVALID_SETTINGS', field: issue?.path.join('.') ?? '' },
      { status: 400 },
    )
  }

  const saved = await saveSettings(db, parsed.data)
  return NextResponse.json(saved)
})
