import { useState } from 'react'
import { Input } from '@/components/ui/input'

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  compact = false,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  compact?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const [observed, setObserved] = useState(value)
  if (observed !== value) {
    setObserved(value)
    setDraft(String(Number(value.toFixed(4))))
  }
  const commit = () => {
    const n = Number(draft)
    if (
      draft.trim() &&
      Number.isFinite(n) &&
      (min == null || n >= min) &&
      (max == null || n <= max)
    ) {
      if (n !== value) onChange(n)
    } else setDraft(String(value))
  }
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className={`${compact ? '' : 'min-w-16 flex-1'} leading-5 text-muted-foreground`}>
        {label}
      </span>
      <Input
        className={`h-8 ${compact ? 'w-20' : 'w-22'} shrink-0 font-mono text-base md:text-base`}
        type="number"
        data-saved-value={value}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(String(value))
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
export const selectClass =
  'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-ring'
