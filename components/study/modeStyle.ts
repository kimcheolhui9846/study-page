import type { StudyMode } from '@/lib/study/modes'

/**
 * 과목마다의 겉모습. 화면 전용이다 — 하네스(lib/study/modes)와 섞지 않는다.
 *
 * Tailwind 는 소스에서 클래스 이름을 글자 그대로 찾으므로 `text-${mode}` 처럼
 * 조립하지 않고 전부 적어 둔다.
 */
export interface ModeStyle {
  /** 과목을 한 글자로. 큰 글씨로 깔린다 */
  glyph: string
  text: string
  bg: string
  tint: string
  border: string
  ring: string
}

export const MODE_STYLE: Record<StudyMode, ModeStyle> = {
  english: {
    glyph: 'Aa', text: 'text-english', bg: 'bg-english', tint: 'bg-english-tint',
    border: 'border-english', ring: 'shadow-[inset_0_0_0_1.5px_var(--color-english)]',
  },
  math: {
    glyph: '∑', text: 'text-math', bg: 'bg-math', tint: 'bg-math-tint',
    border: 'border-math', ring: 'shadow-[inset_0_0_0_1.5px_var(--color-math)]',
  },
  cs: {
    glyph: '01', text: 'text-cs', bg: 'bg-cs', tint: 'bg-cs-tint',
    border: 'border-cs', ring: 'shadow-[inset_0_0_0_1.5px_var(--color-cs)]',
  },
  coding: {
    glyph: '{ }', text: 'text-coding', bg: 'bg-coding', tint: 'bg-coding-tint',
    border: 'border-coding', ring: 'shadow-[inset_0_0_0_1.5px_var(--color-coding)]',
  },
}
