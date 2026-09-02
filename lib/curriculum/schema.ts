import { z } from 'zod'

export const SUBJECTS = ['english', 'math', 'cs'] as const
export type Subject = (typeof SUBJECTS)[number]

/**
 * Topic 이 커리큘럼의 최소 단위다.
 *
 * ★ 순서가 아니라 관계를 갖는다. 일렬 배열이 아니라 그래프의 정점이다.
 * "몇 번째 Day 인가"는 여기 없다 — 그건 학습 결과에 따라 매일 계산된다.
 */

/** 얼마나 필수인가. target_day_count 가 어디까지 담을지를 정한다. */
export const REQUIRED_LEVELS = ['core', 'recommended', 'optional'] as const
export type RequiredLevel = (typeof REQUIRED_LEVELS)[number]

/**
 * Topic 의 성격. GPT 프롬프트가 이걸 보고 달라진다.
 * 어휘는 단어 묶음을, 독해는 지문을 다룬다 — 같은 프롬프트로 낼 수 없다.
 */
export const TOPIC_KINDS = ['concept', 'vocabulary', 'reading', 'practice'] as const
export type TopicKind = (typeof TOPIC_KINDS)[number]

/** Topic ID 는 `{subject}.{domain}.{slug}` 형태다. 소문자·숫자·하이픈만. */
const TOPIC_ID = /^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/

export const TopicSchema = z.object({
  id: z.string().regex(TOPIC_ID, 'Topic ID 는 subject.domain.slug 형태여야 합니다'),
  title: z.string().min(1),
  /** 채점 기준의 앵커. LLM 이 매번 기준을 새로 지어내지 않도록 파일에 고정한다. */
  goal: z.string().min(1),
  kind: z.enum(TOPIC_KINDS).default('concept'),
  difficulty: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().int().min(5).max(120),
  required: z.enum(REQUIRED_LEVELS).default('core'),

  /**
   * 선수 Topic. **과목을 가리지 않는다** — CS 의 머신러닝 Topic 이
   * 수학 Topic 을 선수로 가질 수 있다. 진도는 과목별로 독립이지만
   * 선수 관계는 독립이 아니다.
   */
  prerequisites: z.array(z.string()).default([]),

  /**
   * 이 Topic 이 부족할 때 갈 보충 Topic.
   * 비어 있으면 계획 엔진이 prerequisites 를 거슬러 올라가며 찾는다.
   */
  remediation: z.array(z.string()).default([]),

  /** 간격 반복 복습 간격(일). 회차 수가 곧 복습 콘텐츠 생성 상한이다. */
  reviewIntervals: z.array(z.number().int().positive()).max(4).default([1, 3, 7, 14]),

  /** 이 점수 이상이어야 후속 Topic 이 열린다. */
  passThreshold: z.number().int().min(0).max(100).default(75),

  questionTypes: z.array(z.string().min(1)).default([]),
  keywords: z.array(z.string().min(1)).min(1),
})

export type Topic = z.infer<typeof TopicSchema>

export const ModuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  topics: z.array(TopicSchema).min(1),
})

export type Module = z.infer<typeof ModuleSchema>

export const DomainFileSchema = z.object({
  subject: z.enum(SUBJECTS),
  domain: z.string().min(1),
  label: z.string().min(1),
  /** 영역 안에서의 순서. 화면 정렬과 같은 조건일 때의 우선순위에 쓴다. */
  order: z.number().int().min(0).default(0),
  modules: z.array(ModuleSchema).min(1),
})

export type DomainFile = z.infer<typeof DomainFileSchema>

/** 과목을 넘는 연결. 선수 관계가 아니라 "왜 이걸 배우나"를 보여주는 선이다. */
export const LINK_KINDS = ['enables', 'related', 'applied-in'] as const

export const LinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(LINK_KINDS),
  note: z.string().default(''),
})

export type Link = z.infer<typeof LinkSchema>

export const LinksFileSchema = z.object({
  links: z.array(LinkSchema).default([]),
})
