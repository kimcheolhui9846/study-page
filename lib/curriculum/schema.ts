import { z } from 'zod'

export const SUBJECTS = ['english', 'math', 'cs'] as const
export type Subject = (typeof SUBJECTS)[number]

export const DayEntrySchema = z.object({
  day:        z.number().int().positive(),
  topic:      z.string().min(1),
  /** 채점 기준이 된다. LLM 이 매번 기준을 새로 지어내지 않도록 파일에 고정한다. */
  goal:       z.string().min(1),
  keywords:   z.array(z.string().min(1)).min(1),
  difficulty: z.number().int().min(1).max(5),
})

export const CurriculumSchema = z
  .object({
    subject: z.enum(SUBJECTS),
    label:   z.string().min(1),
    days:    z.array(DayEntrySchema).min(1),
  })
  .superRefine((c, ctx) => {
    // Day 번호는 배열 인덱스와 일치해야 한다.
    // 구멍이나 중복이 있으면 진도 계산(MAX(day_no) + 1)이 조용히 어긋난다.
    c.days.forEach((d, i) => {
      if (d.day !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `day 번호는 1부터 연속이어야 합니다. ${i} 번째 항목의 day 가 ${d.day} 입니다`,
          path: ['days', i, 'day'],
        })
      }
    })
  })

export type DayEntry = z.infer<typeof DayEntrySchema>
export type Curriculum = z.infer<typeof CurriculumSchema>
