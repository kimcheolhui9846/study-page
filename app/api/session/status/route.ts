import { withSession } from '@/lib/session/guard'
import { sessionStatusHandler } from '@/lib/session/status'

export const GET = withSession(sessionStatusHandler)
