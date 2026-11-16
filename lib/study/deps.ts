import { db } from '../db/client'
import { systemClock } from '../time'
import { OpenAiLlmClient } from '../llm/client'
import type { StudyDeps } from './call'

/**
 * 자유학습의 프로덕션 의존성. 라우트가 이걸 쓰고, 테스트는 자기 것을 만든다.
 * 여기 말고 다른 곳에서 OpenAiLlmClient 를 새로 만들지 않는다.
 */
export function studyDeps(): StudyDeps {
  return { db, clock: systemClock, llm: new OpenAiLlmClient() }
}
