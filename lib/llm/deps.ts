import { db } from '../db/client'
import { systemClock } from '../time'
import { loadGraph } from '../curriculum/load'
import { OpenAiLlmClient } from './client'
import type { EnsureDeps } from './ensure'

/**
 * 프로덕션 의존성 묶음. 라우트가 이걸 쓰고, 테스트는 자기 것을 만든다.
 *
 * 여기 말고 다른 곳에서 OpenAiLlmClient 를 새로 만들지 않는다 — 라우트마다
 * 클라이언트를 만들면 어디서 LLM 을 부르는지 세기 어려워진다.
 */
export function llmDeps(): EnsureDeps {
  return { db, clock: systemClock, llm: new OpenAiLlmClient(), graph: loadGraph() }
}
