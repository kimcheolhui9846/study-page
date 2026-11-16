import { coding } from './coding'
import { cs } from './cs'
import { english } from './english'
import { math } from './math'
import { STUDY_MODES, type ModeHarness, type StudyMode } from './types'

export * from './types'

export const MODES: Record<StudyMode, ModeHarness> = { english, math, cs, coding }

export function isStudyMode(x: unknown): x is StudyMode {
  return typeof x === 'string' && (STUDY_MODES as readonly string[]).includes(x)
}

export function getMode(m: StudyMode): ModeHarness {
  return MODES[m]
}
