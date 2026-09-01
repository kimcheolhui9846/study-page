'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Settings } from '@/lib/settings/store'
import {
  TARGET_DAYS_MIN, TARGET_DAYS_MAX, DAILY_MINUTES_MIN, DAILY_MINUTES_MAX,
} from '@/lib/settings/store'

export interface SettingsFormProps {
  initial: Settings
  /** 커리큘럼이 담은 총 분량. 목표가 가능한지 그 자리에서 보여준다 */
  totalMinutes: number
}

const SUBJECT_LABEL = { english: '영어', math: '수학', cs: '컴퓨터 과학' } as const
type SubjectKey = keyof typeof SUBJECT_LABEL

/**
 * 설정 화면.
 *
 * ★ 바꾼 값이 무엇을 바꾸는지 그 자리에서 보여준다. 목표 기간과 하루 시간을
 * 움직이면 "이 커리큘럼은 며칠치인가"가 즉시 다시 계산된다 — 저장하고
 * 대시보드로 돌아가서야 알게 되면 그건 설정이 아니라 추측이다.
 */
export function SettingsForm({ initial, totalMinutes }: SettingsFormProps) {
  const router = useRouter()
  const [form, setForm] = useState<Settings>(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredDays = Math.ceil(totalMinutes / Math.max(1, form.dailyStudyMinutes))
  const fits = requiredDays <= form.targetDayCount

  const ratioSum = (['english', 'math', 'cs'] as const)
    .reduce((n, s) => n + form.subjectPriority[s], 0)

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  function setRatio(subject: SubjectKey, value: number) {
    set('subjectPriority', { ...form.subjectPriority, [subject]: value })
  }

  async function submit() {
    setBusy(true)
    setError(null)

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (res.ok) {
      setSaved(true)
      setBusy(false)
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      body.error === 'INVALID_SETTINGS'
        ? `값이 범위를 벗어났다 (${body.field || '알 수 없는 항목'})`
        : '저장하지 못했다. 잠시 뒤 다시 시도해라.',
    )
    setBusy(false)
  }

  return (
    <div className="mt-14 flex flex-col gap-6">
      <Field
        label="목표 기간"
        value={form.targetDayCount}
        unit="일"
        min={TARGET_DAYS_MIN}
        max={TARGET_DAYS_MAX}
        note={`${TARGET_DAYS_MIN}일 ~ ${TARGET_DAYS_MAX}일`}
        onChange={(n) => set('targetDayCount', n)}
      />

      <Field
        label="하루 학습 시간"
        value={form.dailyStudyMinutes}
        unit="분"
        min={DAILY_MINUTES_MIN}
        max={DAILY_MINUTES_MAX}
        note={`${DAILY_MINUTES_MIN}분 ~ ${DAILY_MINUTES_MAX}분 · 계획이 이 시간에 맞춰 잘린다`}
        onChange={(n) => set('dailyStudyMinutes', n)}
      />

      {/* 바꾸는 즉시 다시 계산된다. 저장 전에도 결과를 안다. */}
      <p className={`text-center text-[12.5px] leading-relaxed ${fits ? 'text-muted' : 'text-warn'}`}>
        {fits
          ? `이 커리큘럼은 ${requiredDays}일치다 · 목표 안에 들어간다`
          : `이 커리큘럼은 ${requiredDays}일치다 · 목표보다 ${requiredDays - form.targetDayCount}일 길다`}
      </p>

      <div className="mt-2 rounded-card bg-surface px-6 py-6 shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-8 sm:py-7">
        <h2 className="text-center font-mono text-[10px] tracking-[0.22em] text-faint">
          과목 비중
        </h2>
        <p className="mt-4 text-center text-balance text-[12.5px] leading-[1.8] text-muted">
          하루 시간을 어떻게 나눌지의 출발점이다. 못 넘긴 과목과 밀린 복습이
          있으면 계획 엔진이 여기서 더 조정한다.
        </p>

        <div className="mt-7 flex flex-col gap-5">
          {(['english', 'math', 'cs'] as const).map((s) => (
            <div key={s} className="flex items-center gap-4">
              <span className="w-20 shrink-0 text-[13.5px] text-body sm:w-24">{SUBJECT_LABEL[s]}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.subjectPriority[s]}
                onChange={(e) => setRatio(s, Number(e.target.value))}
                className="h-1 grow cursor-pointer appearance-none rounded-sm bg-rule-soft accent-ink"
              />
              <span className="w-14 shrink-0 text-right font-mono text-[12.5px] text-muted">
                {ratioSum === 0 ? '—' : `${Math.round((form.subjectPriority[s] / ratioSum) * 100)}%`}
              </span>
            </div>
          ))}
        </div>

        {ratioSum === 0 && (
          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-warn">
            전부 0 이면 기본 비중(영어 30 · 수학 30 · CS 40)으로 돌아간다.
          </p>
        )}
      </div>

      <div className="mx-auto mt-6 h-px w-16 bg-rule" />

      {error && <p className="text-center text-[12.5px] text-stop">{error}</p>}

      <div className="flex flex-col items-center gap-4">
        <button
          onClick={submit}
          disabled={busy}
          className="h-12 w-full max-w-[280px] cursor-pointer rounded-control bg-ink text-[14px] font-medium tracking-[0.04em] text-paper transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? '저장 중…' : saved ? '저장했다' : '저장하기'}
        </button>

        {/* ★ 숨기지 않는다. 오늘 계획은 이미 확정돼 있다. */}
        <p className="max-w-[380px] text-balance text-center text-[12px] leading-[1.8] text-faint">
          오늘 계획은 이미 짜여 있어 바뀌지 않는다. 새 설정은 내일 계획부터 적용된다.
        </p>
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  note: string
  onChange: (n: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-6 text-center shadow-[inset_0_0_0_1px_var(--color-rule)] sm:px-8 sm:py-7">
      <span className="font-mono text-[10px] tracking-[0.22em] text-faint">{props.label}</span>

      <div className="flex items-baseline gap-2">
        <input
          type="number"
          value={props.value}
          min={props.min}
          max={props.max}
          onChange={(e) => props.onChange(Number(e.target.value))}
          className="w-24 rounded-control bg-paper px-3 py-2 text-center font-serif text-[26px] tracking-[-0.02em] text-ink shadow-[inset_0_0_0_1px_var(--color-rule)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
        />
        <span className="font-mono text-[13px] text-faint">{props.unit}</span>
      </div>

      <span className="text-[11.5px] leading-[1.6] text-faint">{props.note}</span>
    </div>
  )
}
