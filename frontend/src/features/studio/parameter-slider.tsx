import { useState } from 'react'
import { Slider } from '@/components/ui/slider'

export function ParameterSlider({ label, value, min, max, step = 1, disabled = false, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  format?: (value: number) => string
  onChange: (value: number) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const shown = draft ?? value
  return (
    <div className="min-w-0" data-unsaved={draft != null && draft !== value}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <output className="shrink-0 text-base tabular-nums">
          {format ? format(shown) : Number(shown.toFixed(4))}
        </output>
      </div>
      <Slider thumbLabel={label} value={[shown]} min={min} max={max > min ? max : min + step} step={step}
        disabled={disabled || pending || max <= min}
        onValueChange={(values) => setDraft(Array.isArray(values) ? values[0] : values)}
        onValueCommitted={(values) => {
          const next = Array.isArray(values) ? values[0] : values
          if (next === value) { setDraft(null); return }
          setPending(true)
          // Dragging changes the control only; persist one accepted edit on release.
          void Promise.resolve(onChange(next)).finally(() => {
            setDraft(null)
            setPending(false)
          })
        }} />
    </div>
  )
}
