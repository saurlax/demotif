import { useErrorToast } from '@/hooks/use-error-toast'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { currentVocal, cancelVocal, synthesizeVocal } from '@/lib/api'
import type { Project, Source } from '@/types/project'
import type { VocalRenderStatus, VocalVoice } from '@/types/vocal'
import { hasDraftChanges } from './save-status'
import { applyVocalEntry, vocalEntryPreview, assignVocalLyrics, vocalSyllableError, vocalScoreError } from '@/lib/vocal-lyrics'
import { ParameterSlider } from './parameter-slider'

type Vocal = NonNullable<Source['vocal']>
function useVoice(source: Source) {
  const [voice, setVoice] = useState<VocalVoice>()
  useEffect(() => { let active = true
    void import('@/lib/api').then((api) => api.listVocalVoices()).then((voices) => {
      if (active) setVoice(voices.find((v) => v.id === source.vocal?.voice_id))
    }).catch(() => {})
    return () => { active = false }
  }, [source.vocal?.voice_id])
  return voice
}
export function VocalRenderControls({ project, source, disabled, onError }: {
  project: Project; source: Source; disabled: boolean; onError: (message: string) => void
}) {
  const [status, setStatus] = useState<VocalRenderStatus>()
  const [pending, setPending] = useState(false)
  const owner = useRef({ project: project.id, source: source.id })
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await currentVocal(project.id, source.id)
        if (!active) return
        setStatus(next)
        if (next.status === 'queued' || next.status === 'running') timer = setTimeout(poll, 700)
      } catch (e) { if (active) onError(String(e)) }
    }
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sourceId?: string }>).detail
      if (detail.projectId === project.id && (!detail.sourceId || detail.sourceId === source.id)) { clearTimeout(timer); void poll() }
    }
    window.addEventListener('demotif:vocal-render', refresh)
    void poll()
    return () => { active = false; clearTimeout(timer); window.removeEventListener('demotif:vocal-render', refresh) }
  }, [project.id, project.version, source.id, pending, onError])
  useErrorToast(status?.current && status.error ? status.error : undefined, `vocal-render:${project.id}:${source.id}`)
  // Polling ends on editor closure. Durable jobs remain available for playback/reopening.
  const busy = status?.status === 'queued' || status?.status === 'running'
  const label = busy ? status.stage ?? status.status : status?.status === 'ready'
    ? status.current ? 'Ready' : 'Score changed' : status?.status === 'missing' ? 'Not synthesized' : status?.status
  return <div className="flex shrink-0 items-center gap-2 text-sm">
    <span role="status" className={status?.current && status.status === 'ready' ? 'text-playback' : 'text-muted-foreground'}>{label}</span>
    <Button size="sm" variant="outline" disabled={pending || disabled} onClick={async () => {
      const scoreError = !busy && vocalScoreError(source)
      if (scoreError) { onError(scoreError); return }
      if (!busy && hasDraftChanges(document)) { onError('Apply pending lyric or parameter edits before synthesis.'); return }
      setPending(true)
      const selected = owner.current
      try {
        const result = busy && status ? await cancelVocal(selected.project, status.id)
          : await synthesizeVocal(project.id, source.id, project.version)
        setStatus(result)
      } catch (e) { onError(e instanceof Error ? e.message : 'Singing synthesis failed') }
      finally { setPending(false) }
    }}>{busy ? 'Cancel' : status?.status === 'failed' || status?.status === 'interrupted' ? 'Retry' : 'Synthesize'}</Button>
  </div>
}

export function VocalNoteFields({ source, noteId, disabled, update, onApplied }: {
  source: Source; noteId: string; disabled: boolean; update: (patch: Pick<Source, 'notes' | 'vocal'>) => Promise<void>; onApplied: () => void
}) {
  const voice = useVoice(source)
  const vocal = source.vocal!, assignment = vocal.syllables[noteId]
  const savedLyric = assignment?.kind === 'continue' ? '-' : assignment?.lyric ?? ''
  const [lyric, setLyric] = useState(savedLyric)
  const [pronunciation, setPronunciation] = useState(assignment?.kind === 'syllable' ? assignment.pronunciation ?? '' : '')
  const savedPhones = assignment?.kind === 'syllable' ? assignment.phonemes?.map((p) => p.symbol + (p.duration_beats == null ? '' : `:${p.duration_beats}`)).join(' ') ?? '' : ''
  const [phones, setPhones] = useState(savedPhones)
  const [saveError, setSaveError] = useState('')
  const preview = vocalEntryPreview(source, noteId, lyric)
  const validationError = vocalSyllableError(lyric, pronunciation, vocal.language)
  useErrorToast(validationError || saveError, `vocal-note:${source.id}:${noteId}`)
  const save = async (split = false) => {
    if (validationError) return
    setSaveError('')
    const phonemes = phones.trim() ? phones.trim().split(/\s+/).map((token) => {
      const [symbol, duration] = token.split(':')
      return { symbol, ...(duration ? { duration_beats: Number(duration) } : {}) }
    }) : undefined
    await update(applyVocalEntry(source, noteId, lyric, { pronunciation, phonemes, split }))
    onApplied()
  }
  const dirty = lyric !== savedLyric || pronunciation !== (assignment?.kind === 'syllable' ? assignment.pronunciation ?? '' : '') || phones !== savedPhones
  const vib = vocal.vibrato[noteId] ?? { rate_hz: 5.5, depth_cents: 0, onset: 0.5 }
  const updateVocal = async (next: Vocal) => {
    try { await update({ notes: source.notes, vocal: next }) } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)) }
  }
  return <fieldset disabled={disabled} className="space-y-3" data-vocal-note-dirty={dirty} data-unsaved={dirty} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}>
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save().catch((e: Error) => setSaveError(e.message)) }}>
      <Label htmlFor={`lyric-${noteId}`}>Lyrics</Label>
      <Input id={`lyric-${noteId}`} aria-invalid={!!validationError} aria-describedby={validationError ? `lyric-error-${noteId}` : undefined}
        value={lyric} onChange={(e) => { setLyric(e.target.value); setSaveError('') }} data-saved-value={savedLyric} />
      <Label htmlFor={`pinyin-${noteId}`}>{vocal.language === 'zh' ? 'Pinyin · optional' : 'Pronunciation · optional'}</Label>
      <Input id={`pinyin-${noteId}`} aria-invalid={!!validationError} aria-describedby={validationError ? `lyric-error-${noteId}` : undefined}
        value={pronunciation} data-saved-value={assignment?.kind === 'syllable' ? assignment.pronunciation ?? '' : ''}
        onChange={(e) => { setPronunciation(e.target.value); setSaveError('') }} placeholder={vocal.language === 'zh' ? 'yin yue' : ''} />
      <details className="space-y-2"><summary className="cursor-pointer text-sm">Phoneme override</summary>
        <Label htmlFor={`phones-${noteId}`}>Phonemes · overrides pronunciation</Label>
        <Input id={`phones-${noteId}`} value={phones} data-saved-value={savedPhones} onChange={(e) => { setPhones(e.target.value); setSaveError('') }}
          placeholder="n i" aria-label="Phonemes, optional :duration in beats" />
      </details>
      {(validationError || saveError) && <p id={`lyric-error-${noteId}`} className="sr-only">{validationError || saveError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={!!validationError}>Apply lyrics</Button>
        {preview.tokens.length > 1 && <Button type="button" size="sm" variant="outline" disabled={!!validationError}
          onClick={() => void save(true).catch((e: Error) => setSaveError(e.message))}>Split into {preview.tokens.length} notes</Button>}
        <Button size="sm" type="button" variant={assignment?.kind === 'continue' ? 'secondary' : 'ghost'}
          onClick={() => void update({ notes: source.notes, vocal: { ...vocal, syllables: { ...vocal.syllables, [noteId]: { kind: 'continue' } } } }).then(onApplied).catch((e: Error) => setSaveError(e.message))}>Continue syllable</Button>
      </div>
    </form>
    {voice?.controls.vibrato && <details className="space-y-3"><summary className="cursor-pointer text-sm">Vibrato</summary>
    <ParameterSlider label="Vibrato depth" value={vib.depth_cents} min={0} max={200} format={(v) => `${v} cents`}
      onChange={(depth_cents) => updateVocal({ ...vocal, vibrato: { ...vocal.vibrato, [noteId]: { ...vib, depth_cents } } })} />
    <ParameterSlider label="Vibrato rate" value={vib.rate_hz} min={1} max={12} step={0.1} format={(v) => `${v.toFixed(1)} Hz`}
      onChange={(rate_hz) => updateVocal({ ...vocal, vibrato: { ...vocal.vibrato, [noteId]: { ...vib, rate_hz } } })} />
    <ParameterSlider label="Vibrato onset" value={vib.onset} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`}
      onChange={(onset) => updateVocal({ ...vocal, vibrato: { ...vocal.vibrato, [noteId]: { ...vib, onset } } })} />
    </details>}
  </fieldset>
}
export function VocalLyrics({ source, disabled, update }: { source: Source; disabled: boolean; update: (v: Vocal) => Promise<void> }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [initialText, setInitialText] = useState(''), [error, setError] = useState('')
  const notes = [...source.notes].sort((a, b) => a.start - b.start)
  let assignmentError = ''
  try { assignVocalLyrics(source, text) } catch (e) { assignmentError = e instanceof Error ? e.message : 'Invalid lyrics' }
  useErrorToast(open ? assignmentError || error : undefined, `vocal-lyrics:${source.id}`)
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
      const initial = notes.map((n) => { const s = source.vocal!.syllables[n.id]; return s?.kind === 'continue' ? '-' : s?.lyric || '_' }).join(' ')
      setText(initial); setInitialText(initial); setError(''); setOpen(true)
    }}>Lyrics</Button>
    <DialogContent><DialogHeader><DialogTitle>Assign lyrics</DialogTitle></DialogHeader>
      <form className="space-y-3" data-unsaved={text !== initialText} onSubmit={async (e) => {
        e.preventDefault()
        try {
          await update(assignVocalLyrics(source, text))
          setOpen(false)
        } catch (e) { setError(String(e)) }
      }}>
        <Label htmlFor="phrase-lyrics">{source.vocal!.language === 'zh' ? 'Chinese characters or spaced pinyin · - continues a syllable' : 'Syllables in note order · - continues a syllable'}</Label>
        <Input id="phrase-lyrics" value={text} aria-invalid={!!assignmentError} aria-describedby={assignmentError ? 'phrase-lyrics-error' : undefined} onChange={(e) => { setText(e.target.value); setError('') }} autoFocus />
        {(assignmentError || error) && <p id="phrase-lyrics-error" className="sr-only">{assignmentError || error}</p>}
        <Button type="submit" disabled={!!assignmentError}>Apply lyrics</Button>
      </form>
    </DialogContent>
  </Dialog>
}

export function VocalExpression({ source, disabled, update }: { source: Source; disabled: boolean; update: (v: Vocal) => Promise<void> }) {
  const voice = useVoice(source)
  const [lane, setLane] = useState<'pitch' | 'volume' | null>(null)
  const [draft, setDraft] = useState<{ beat: number; value: number }[] | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  useEffect(() => () => cancel.current?.(), [])
  const points = draft ?? (lane ? source.vocal![lane] : [])
  const width = Math.max(600, source.duration * 48), height = 88
  const range = lane === 'pitch' ? [-200, 200] : [0, 2]
  const y = (value: number) => height - (value - range[0]) / (range[1] - range[0]) * height
  return <div className="shrink-0 border-t" data-unsaved={draft != null}>
    <div className="flex h-9 items-center gap-1 px-3">
      {(['pitch', 'volume'] as const).map((key) => <Button key={key} size="sm" variant={lane === key ? 'secondary' : 'ghost'}
        disabled={key === 'pitch' ? !voice?.controls.pitch : !voice?.controls.volume}
        aria-expanded={lane === key} onClick={() => { cancel.current?.(); setLane(lane === key ? null : key) }}>{key === 'pitch' ? 'Pitch curve' : 'Volume curve'}</Button>)}
      {lane && <Button size="sm" variant="ghost" disabled={disabled || points.length > source.duration * 4}
        onClick={() => {
          let beat = 0
          while (points.some((p) => p.beat === beat)) beat += 0.25
          if (beat <= source.duration) void update({ ...source.vocal!, [lane]: [...points, { beat, value: lane === 'pitch' ? 0 : 1 }].sort((a, b) => a.beat - b.beat) })
        }}>Add point</Button>}
      {lane && <Button size="sm" variant="ghost" disabled={disabled || !points.length} onClick={() => void update({ ...source.vocal!, [lane]: [] })}>Reset</Button>}
    </div>
    {lane && <div className="flex h-28 min-w-0 text-xs">
      <div className="flex w-20 shrink-0 flex-col justify-between px-2 py-2 text-right text-muted-foreground"><span>{range[1]} {lane === 'pitch' ? 'cents' : '×'}</span><span>{range[0]}</span></div>
      <div className="min-w-0 flex-1 overflow-x-auto"><svg role="group" aria-label={`${lane} expression lane`} width={width} height={height + 20} className="touch-none select-none"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return
          event.preventDefault()
          cancel.current?.()
          const target = event.currentTarget, bounds = target.getBoundingClientRect(), pointerId = event.pointerId
          let latest = source.vocal![lane]
          const at = (e: { clientX: number; clientY: number }) => ({
            beat: Math.max(0, Math.min(source.duration, Math.round((e.clientX - bounds.left) / width * source.duration * 16) / 16)),
            value: Math.max(range[0], Math.min(range[1], Math.round((range[1] - (e.clientY - bounds.top) / height * (range[1] - range[0])) * 100) / 100)),
          })
          const initial = at(event)
          const remaining = latest.filter((p) => Math.abs(p.beat - initial.beat) > 0.125)
          const change = (e: { clientX: number; clientY: number }) => {
            const point = at(e)
            latest = [...remaining.filter((p) => p.beat !== point.beat), point].sort((a, b) => a.beat - b.beat)
            setDraft(latest)
          }
          change(event)
          target.setPointerCapture(pointerId)
          const finish = (save: boolean) => {
            cancel.current = null
            target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', abort)
            window.removeEventListener('blur', abort); window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', hidden); target.removeEventListener('lostpointercapture', abort)
            if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
            setDraft(null)
            if (save) void update({ ...source.vocal!, [lane]: latest })
          }
          const move = (e: PointerEvent) => { if (e.pointerId === pointerId) change(e) }
          const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(true) }
          const abort = () => finish(false)
          const hidden = () => { if (document.hidden) abort() }
          const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); abort() } }
          cancel.current = abort
          target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', abort)
          window.addEventListener('blur', abort); window.addEventListener('keydown', key); document.addEventListener('visibilitychange', hidden); target.addEventListener('lostpointercapture', abort)
        }}>
        {Array.from({ length: Math.ceil(source.duration) + 1 }, (_, i) => <line key={i} x1={i * 48} x2={i * 48} y1={0} y2={height} stroke="var(--border)" />)}
        <line x1={0} x2={width} y1={y(lane === 'pitch' ? 0 : 1)} y2={y(lane === 'pitch' ? 0 : 1)} stroke="var(--muted-foreground)" strokeDasharray="3 4" />
        <polyline points={points.map((p) => `${p.beat * 48},${y(p.value)}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2} />
        {points.map((p, i) => <circle key={p.beat} cx={p.beat * 48} cy={y(p.value)} r={5} fill="var(--primary)" tabIndex={disabled ? -1 : 0}
          role="slider" aria-label={`${lane} at beat ${p.beat + 1}`} aria-valuenow={p.value} aria-valuemin={range[0]} aria-valuemax={range[1]}
          onKeyDown={(e) => {
            if (!['ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(e.key)) return
            e.preventDefault(); e.stopPropagation()
            const next = points.filter((_, index) => index !== i)
            if (e.key.startsWith('Arrow')) next.push({ ...p, value: Math.max(range[0], Math.min(range[1], p.value + (e.key === 'ArrowUp' ? 1 : -1) * (lane === 'pitch' ? 10 : 0.05))) })
            void update({ ...source.vocal!, [lane]: next.sort((a, b) => a.beat - b.beat) })
          }} />)}
      </svg></div>
    </div>}
  </div>
}

export function VocalVoiceSettings({ source, update }: { source: Source; update: (v: Vocal) => Promise<void> }) {
  const [voices, setVoices] = useState<import('@/types/vocal').VocalVoice[]>([])
  const [error, setError] = useState('')
  useEffect(() => { let active = true
    void import('@/lib/api').then((api) => api.listVocalVoices()).then((v) => { if (active) setVoices(v) }).catch((e) => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [])
  const vocal = source.vocal!, voice = voices.find((v) => v.id === vocal.voice_id)
  useErrorToast(error || voice?.reason, `vocal-voice:${source.id}`)
  return <div className="space-y-3 sm:col-span-2">
    <Label htmlFor="vocal-voice">Voice</Label>
    <select id="vocal-voice" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={vocal.voice_id} onChange={(e) => {
      const next = voices.find((v) => v.id === e.target.value)!
      void update({ ...vocal, voice_id: next.id, language: next.languages[0] }).catch((e) => setError(String(e)))
    }}>
      {!voice && <option value={vocal.voice_id}>{vocal.voice_id} · unavailable</option>}
      {voices.map((v) => <option key={v.id} value={v.id} disabled={!v.ready}>{v.name}</option>)}
    </select>
    <Label htmlFor="vocal-language">Language</Label>
    <select id="vocal-language" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={vocal.language}
      onChange={(e) => void update({ ...vocal, language: e.target.value }).catch((e) => setError(String(e)))}>
      {(voice?.languages ?? [vocal.language]).map((language) => <option key={language}>{language}</option>)}
    </select>
    {voice && <p className="text-sm text-muted-foreground">{voice.usage}{!voice.controls.automaticPitch || !voice.controls.automaticTiming ? ' · Manual pitch and initial phoneme timing' : ''}</p>}
  </div>
}
