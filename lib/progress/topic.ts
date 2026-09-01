import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { dailyPlans, planItems } from '../db/schema'
import type { Db } from '../db/types'
import { daysBetween, kstToday, type Clock } from '../time'
import { loadGraph } from '../curriculum/load'
import type { TopicNode } from '../curriculum/graph'
import { isUnlocked } from '../mastery/transition'
import { recoveryPhaseOf, type Recovery } from '../mastery/recovery'
import { loadMaterialKeys, materialKey } from '../llm/ensure'
import type { ProgressState } from '../plan/types'
import { loadProgressMap } from '../plan/store'

/**
 * Topic 하나의 모든 것.
 *
 * "왜 이게 아직 안 열렸나", "왜 오늘 또 나왔나", "언제 다시 보나" —
 * 계획 화면이 한 줄로만 답하던 것들을 여기서 근거까지 보여준다.
 */

export interface RelatedTopic {
  id: string
  title: string
  subject: string
  score: number
  passThreshold: number
  passed: boolean
  /** 과목을 넘는 관계인가. 진도가 막힌 이유가 대개 여기 있다 */
  crossing: boolean
}

export interface AttemptRecord {
  studyDate: string
  kind: string
  round: number | null
  score: number
}

export interface TopicDetail {
  topic: TopicNode
  /** 학습한 적이 없으면 null */
  progress: ProgressState | null
  /** 선수를 다 넘겼나 */
  unlocked: boolean
  prerequisites: RelatedTopic[]
  /** 이 Topic 이 막고 있는 것 */
  unlocks: RelatedTopic[]
  /** `_links.yaml` 의 과목 간 연결 */
  connections: Array<{ note: string; otherTitle: string }>
  /** 못 넘긴 상태일 때의 회복 단계. 그 외에는 null */
  recovery: Recovery | null
  history: AttemptRecord[]
  /** 자료가 이미 만들어져 있나. 다시 열어도 호출이 0회라는 뜻이다 */
  hasMaterial: boolean
  /** 오늘 계획에 들어 있나. 들어 있어야 학습 화면으로 갈 수 있다 */
  inTodaysPlan: boolean
}

function relate(
  graph: ReturnType<typeof loadGraph>,
  from: TopicNode,
  ids: string[],
  progress: Map<string, ProgressState>,
): RelatedTopic[] {
  return ids
    .map((id) => graph.topics.get(id))
    .filter((n): n is TopicNode => n !== undefined)
    .map((n) => {
      const score = progress.get(n.id)?.masteryScore ?? 0
      return {
        id: n.id,
        title: n.title,
        subject: n.subject,
        score,
        passThreshold: n.passThreshold,
        passed: score >= n.passThreshold,
        crossing: n.subject !== from.subject,
      }
    })
}

export async function loadTopicDetail(
  db: Db, clock: Clock, topicId: string,
): Promise<TopicDetail | null> {
  const graph = loadGraph()
  const topic = graph.topics.get(topicId)
  if (!topic) return null

  const progressMap = await loadProgressMap(db)
  const st = progressMap.get(topicId) ?? null

  const prerequisites = relate(graph, topic, topic.prerequisites, progressMap)
  const unlocks = relate(graph, topic, graph.dependents.get(topicId) ?? [], progressMap)

  // 회복 단계는 못 넘긴 상태에서만 뜻이 있다.
  const today = kstToday(clock.now())

  const recovery = st?.status === 'weak'
    ? recoveryPhaseOf({
        attemptCount: st.attemptCount,
        targets: relate(
          graph, topic, [...topic.prerequisites, ...topic.remediation], progressMap,
        ).map((r) => ({ id: r.id, score: r.score, passThreshold: r.passThreshold })),
        daysSinceStudied: st.lastStudiedAt
          ? Math.max(0, daysBetween(st.lastStudiedAt, today))
          : null,
      })
    : null

  const rows = await db
    .select({
      studyDate: dailyPlans.studyDate,
      kind: planItems.kind,
      round: planItems.round,
      score: planItems.score,
    })
    .from(planItems)
    .innerJoin(dailyPlans, eq(dailyPlans.id, planItems.planId))
    .where(and(eq(planItems.topicId, topicId), isNotNull(planItems.score)))
    .orderBy(desc(dailyPlans.studyDate))

  const [todayRow] = await db
    .select({ id: planItems.id })
    .from(planItems)
    .innerJoin(dailyPlans, eq(dailyPlans.id, planItems.planId))
    .where(and(eq(planItems.topicId, topicId), eq(dailyPlans.studyDate, today)))
    .limit(1)

  const materials = await loadMaterialKeys(db)

  return {
    topic,
    progress: st,
    unlocked: isUnlocked(
      prerequisites.map((p) => ({ score: p.score, passThreshold: p.passThreshold })),
    ),
    prerequisites,
    unlocks,
    connections: graph.links
      .filter((l) => (l.from === topicId || l.to === topicId) && l.note !== '')
      .map((l) => ({
        note: l.note,
        otherTitle: graph.topics.get(l.from === topicId ? l.to : l.from)?.title ?? '',
      })),
    recovery,
    history: rows.map((r) => ({
      studyDate: r.studyDate,
      kind: r.kind,
      round: r.round,
      score: r.score!,
    })),
    hasMaterial: materials.has(materialKey(topicId, 'new', null)),
    inTodaysPlan: todayRow !== undefined,
  }
}
