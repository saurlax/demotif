import { editorPlaybackClip } from './editor-playback'
import { NOTE_GRID, snapNoteDuration, formatNoteDuration, removeEditorNote } from './note-editing'
import { resolveVocalSource } from '@/audio/vocal-resolution'
import { hasDraftChanges } from './save-status'
import { VocalRenderControls, VocalNoteFields, VocalLyrics, VocalExpression, VocalVoiceSettings } from './vocal-controls'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Play, Square, X, Copy, ArrowUp, ArrowDown, Trash2, SlidersHorizontal, Loader2 } from 'lucide-react'
import { uploadAudio } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ParameterSlider } from './parameter-slider'
import { Input } from '@/components/ui/input'
import { AudioEngine, waveform } from '@/audio/audio'
import { beatsPerBar, renderSource, renderClip, renderProject } from '@/audio/adapter'
import { SOUND_IDS, SOUND_NAMES, DRUM_KITS } from '@/audio/soundDefinitions'
import { useStudioStore } from '@/stores/studio'
import { NumberField, selectClass } from './controls'
import type {
  Project,
  Source,
  Clip,
  Note,
  ProducerCommand,
} from '@/types/project'

const pitchName = (p: number) =>
  `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][p % 12]}${Math.floor(p / 12) - 1}`
const drumRows = [
  { pitch: 49, name: 'Crash' },
  { pitch: 46, name: 'Open hat' },
  { pitch: 42, name: 'Hi-hat' },
  { pitch: 39, name: 'Clap' },
  { pitch: 38, name: 'Snare' },
  { pitch: 37, name: 'Rim' },
  { pitch: 36, name: 'Kick' },
]
export function PartEditor({
  interactive = true,
  project,
  source,
  clip,
  engine,
  commit,
  onClose,
  onError,
  onRecordReference,
}: {
  interactive?: boolean
  project: Project
  source: Source
  clip?: Clip
  engine: AudioEngine
  commit: (commands: ProducerCommand[], throwOnError?: boolean) => Promise<void>
  onClose: () => void
  onError: (message: string) => void
  onRecordReference?: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([]),
    [draftNote, setDraftNote] = useState<Note | null>(null)
  const [loopStage, setLoopStage] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const noteTrigger = useRef<HTMLElement | null>(null)
  function openNoteEditor(trigger: HTMLElement) {
    noteTrigger.current = trigger
    setNoteEditorOpen(true)
  }
  const [parameterSaving, setParameterSaving] = useState(false)
  const [heldPitch, setHeldPitch] = useState<number | null>(null)
  const keyGesture = useRef<{
    pointerId: number
    pitch: number | null
    owner: HTMLButtonElement
  } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const canvasScroll = useRef<HTMLDivElement>(null)
  const positioned = useRef(false)
  const cancelGesture = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelGesture.current?.(), [])
  useEffect(() => {
    if (interactive) return
    cancelGesture.current?.()
    engine.stopPart()
    engine.stopAudition()
    setPlaying(false)
    setSettingsOpen(false)
    setNoteEditorOpen(false)
  }, [interactive, engine])
  const note = source.notes.find((n) => n.id === selected)
  const step = NOTE_GRID,
    scale = source.kind === 'drums' ? 96 : 48,
    rowHeight = 24,
    rulerHeight = 28,
    bar = beatsPerBar(project.document.time_signature)
  const audioPixelsPerSecond = scale * project.document.tempo / 60
  const audioWidth = Math.max(1, source.duration * audioPixelsPerSecond)
  const audioBars = Math.max(32, Math.min(8192, Math.ceil(audioWidth / 2)))
  const [viewportWidth, setViewportWidth] = useState(0)
  const audioCanvasWidth = Math.max(600, viewportWidth, audioWidth)
  useEffect(() => {
    const element = canvasScroll.current
    if (!element) return
    const measure = () => setViewportWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (source.kind === 'audio' && canvasScroll.current)
      canvasScroll.current.scrollLeft = Math.max(0, (clip?.offset ?? 0) * audioPixelsPerSecond - 24)
  }, [source.id, source.kind, clip?.id, clip?.offset, audioPixelsPerSecond])
  const low = Math.max(
      0,
      Math.min(48, ...source.notes.map((n) => n.pitch - 3)),
    ),
    high = Math.min(127, Math.max(84, ...source.notes.map((n) => n.pitch + 3)))
  const pitches =
    source.kind === 'drums'
      ? [
          ...new Set([
            ...drumRows.map((r) => r.pitch),
            ...source.notes.map((n) => n.pitch),
            ...source.drum_samples.map((r) => r.pitch),
          ]),
        ].sort((a, b) => b - a)
      : Array.from({ length: high - low + 1 }, (_, i) => high - i)
  useEffect(() => {
    if (positioned.current || (source.kind !== 'notes' && source.kind !== 'vocal') || !canvasScroll.current)
      return
    const pitch = source.notes.length
      ? source.notes.reduce((sum, n) => sum + n.pitch, 0) / source.notes.length
      : 60
    canvasScroll.current.scrollTop = Math.max(
      0,
      (high - pitch) * rowHeight - canvasScroll.current.clientHeight / 2,
    )
    positioned.current = true
  }, [source.kind, source.notes, high, rowHeight])
  const update = async (patch: Partial<Source>, throwOnError = false) => {
    if (!unlocked) return
    setParameterSaving(true)
    try {
      await commit([{ type: 'source.update', source_id: source.id, ...patch }], throwOnError)
    } finally {
      setParameterSaving(false)
    }
  }
  const notes = (values: Note[]) => {
    if (!source.vocal) return update({ notes: values })
    const ids = new Set(values.map((n) => n.id))
    return update({ notes: values, vocal: { ...source.vocal,
      syllables: Object.fromEntries(Object.entries(source.vocal.syllables).filter(([id]) => ids.has(id))),
      vibrato: Object.fromEntries(Object.entries(source.vocal.vibrato).filter(([id]) => ids.has(id))),
    } })
  }
  const audition = (pitch: number) => {
    if (source.kind === 'vocal') return
    void engine
      .audition(renderSource(source, project.id, project.document.tempo), {
        id: 'preview',
        pitch,
        start: 0,
        duration: 0.2,
        velocity: 0.8,
      })
      .catch((e) => onError(String(e)))
  }
  const releaseKey = useCallback(() => {
    const gesture = keyGesture.current
    keyGesture.current = null
    setHeldPitch(null)
    engine.stopAudition()
    if (gesture?.owner.hasPointerCapture(gesture.pointerId))
      gesture.owner.releasePointerCapture(gesture.pointerId)
  }, [engine])
  useEffect(() => {
    const hide = () => { if (document.hidden) releaseKey() }
    window.addEventListener('blur', releaseKey)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('blur', releaseKey)
      document.removeEventListener('visibilitychange', hide)
      releaseKey()
    }
  }, [releaseKey, source.id])
  function pressKey(event: React.PointerEvent<HTMLButtonElement>, pitch: number) {
    if (event.button !== 0 || keyGesture.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    keyGesture.current = { pointerId: event.pointerId, pitch, owner: event.currentTarget }
    setHeldPitch(pitch)
    audition(pitch)
  }
  function glideKey(event: React.PointerEvent<HTMLButtonElement>) {
    const gesture = keyGesture.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const key = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>('[data-audition-key]')
    const pitch = key && root.current?.contains(key) ? Number(key.dataset.pitch) : null
    if (pitch === gesture.pitch) return
    gesture.pitch = pitch
    setHeldPitch(pitch)
    if (pitch == null) engine.stopAudition()
    else audition(pitch)
  }
  function keyProps(pitch: number) {
    return {
      'data-audition-key': true,
      'data-pitch': pitch,
      'data-active': heldPitch === pitch,
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => pressKey(event, pitch),
      onPointerMove: glideKey,
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === keyGesture.current?.pointerId) releaseKey()
      },
      onPointerCancel: releaseKey,
      onLostPointerCapture: releaseKey,
      onDragStart: (event: React.DragEvent<HTMLButtonElement>) => event.preventDefault(),
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (!event.repeat) { setHeldPitch(pitch); audition(pitch) }
      },
      onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Enter' || event.key === ' ') releaseKey()
      },
      onBlur: () => { if (!keyGesture.current) releaseKey() },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        // Assistive activation has no pointer/key press; ordinary clicks already sounded on pointerdown.
        if (event.detail === 0) audition(pitch)
      },
    }
  }
  useEffect(() => () => engine.stopPart(), [engine])
  useEffect(() => {
    let alive = true
    if (source.kind === 'audio' && source.asset_id) {
      const asset = renderSource(source, project.id, project.document.tempo)
      void engine
        .prepare([asset])
        .then(() => {
          if (alive)
            setPeaks(waveform(engine.buffer(asset), 0, source.duration, audioBars))
        })
        .catch((e) => {
          if (alive) onError(String(e))
        })
    }
    return () => {
      alive = false
    }
  }, [source, project.document.tempo, project.id, engine, onError, audioBars])
  useEffect(() => {
    if (!playing || !interactive) return
    let active = true
    const controller = new AbortController()
    setLoopStage('Preparing clip')
    useStudioStore.getState().stop()
    const synthetic = editorPlaybackClip(source, project.document.tempo, clip)
    const track = project.document.tracks.find((t) =>
      t.clips.some((c) => c.id === clip?.id),
    )
    const prepared = async () => {
      const vocal = source.kind === 'vocal' ? await resolveVocalSource(project, source.id, {
        synthesize: true, signal: controller.signal, onProgress: (stage) => { if (active) setLoopStage(stage) },
      }) : undefined
      if (!active) return
      await engine.playPart(
        renderSource(source, project.id, project.document.tempo, vocal),
        renderClip(synthetic, source, project.document.tempo),
        track?.gain ?? 0.7,
        project.document.tempo,
        track?.effects,
        track
          ? { project: renderProject(project), trackId: track.id }
          : undefined,
      )
      if (active) setLoopStage(null)
    }
    void prepared().catch((e) => {
        if (active) {
          setPlaying(false)
          setLoopStage(null)
          onError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      active = false
      controller.abort()
      setLoopStage(null)
      engine.stopPart()
    }
  }, [playing, interactive, source, clip, project, engine, onError])
  useEffect(
    () =>
      useStudioStore.subscribe((s) => {
        if (s.playing) setPlaying(false)
      }),
    [],
  )
  const unlocked = !project.document.tracks.some((t) =>
    t.clips.some((c) => c.source_id === source.id && (c.locked || t.locked)),
  )
  const instanceLocked = !!clip && (clip.locked || project.document.tracks.some((track) =>
    track.locked && track.clips.some((item) => item.id === clip.id),
  ))
  function add(pitch: number, at: number) {
    if (!unlocked) return
    const start = Math.max(
      0,
      Math.min(source.duration - step, Math.floor(at / step) * step),
    )
    const existing = source.notes.find(
      (n) => n.pitch === pitch && Math.abs(n.start - start) < 1e-5,
    )
    if (existing && source.kind === 'drums') return
    const n = {
      id: crypto.randomUUID(),
      pitch,
      start,
      duration: Math.min(
        source.kind === 'drums' ? step : 1,
        source.duration - start,
      ),
      velocity: 0.8,
    }
    setSelected(n.id)
    audition(pitch)
    void notes([...source.notes, n])
  }
  function deleteNote(id: string) {
    if (!unlocked || parameterSaving) return
    cancelGesture.current?.()
    engine.stopAudition()
    setNoteEditorOpen(false)
    setSelected(null)
    void update(removeEditorNote(source, id))
    requestAnimationFrame(() => canvasScroll.current?.focus({ preventScroll: true }))
  }
  function eraseNote(event: React.MouseEvent, target?: Note) {
    event.preventDefault()
    event.stopPropagation()
    if (target) deleteNote(target.id)
  }
  function drag(e: React.PointerEvent, n: Note) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    cancelGesture.current?.()
    setSelected(n.id)
    const anchor = e.currentTarget as HTMLElement
    setNoteEditorOpen(false)
    if (!unlocked) { openNoteEditor(anchor); return }
    const x = e.clientX,
      y = e.clientY,
      resize = e.clientX - e.currentTarget.getBoundingClientRect().left > e.currentTarget.clientWidth - 7
    let latest = n,
      cancelled = false,
      finished = false,
      moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x, ev.clientY - y) < 3) return
      moved = true
      const delta = Math.round((ev.clientX - x) / scale / step) * step
      latest = resize
        ? {
            ...n,
            duration: snapNoteDuration(n.duration + delta, source.duration - n.start),
          }
        : {
            ...n,
            start: Math.max(
              0,
              Math.min(source.duration - n.duration, n.start + delta),
            ),
            pitch: Math.max(
              0,
              Math.min(127, n.pitch + Math.round((y - ev.clientY) / rowHeight)),
            ),
          }
      setDraftNote(latest)
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        cancelled = true
        finish()
      }
    }
    const cancel = () => {
      cancelled = true
      finish()
    }
    const finish = () => {
      if (finished) return
      finished = true
      cancelGesture.current = null
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('keydown', key)
      setDraftNote(null)
      if (!cancelled && !moved) openNoteEditor(anchor)
      if (!cancelled && latest !== n)
        void notes(
          source.notes.map((item) => (item.id === n.id ? latest : item)),
        )
    }
    cancelGesture.current = cancel
    window.addEventListener('pointercancel', cancel, { once: true })
    window.addEventListener('blur', cancel, { once: true })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('keydown', key)
    audition(n.pitch)
  }
  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <section
      ref={root}
      aria-label="Clip editor"
      className="studio-note-editor studio-edit-surface flex h-full min-h-0 flex-col border-t bg-background"
      onKeyDown={(e) => {
        if (!root.current?.contains(e.target as Node)) return
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLSelectElement
        )
          return
        if (e.key === 'Escape') onClose()
        if (note && unlocked && e.key.startsWith('Arrow')) {
          e.preventDefault()
          const delta = e.shiftKey ? 1 : 0.25
          const start =
            e.key === 'ArrowLeft'
              ? Math.max(0, note.start - delta)
              : e.key === 'ArrowRight'
                ? Math.min(source.duration - note.duration, note.start + delta)
                : note.start
          const pitch = Math.max(
            0,
            Math.min(
              127,
              note.pitch +
                (e.key === 'ArrowUp'
                  ? e.shiftKey
                    ? 12
                    : 1
                  : e.key === 'ArrowDown'
                    ? e.shiftKey
                      ? -12
                      : -1
                    : 0),
            ),
          )
          void notes(
            source.notes.map((n) =>
              n.id === note.id ? { ...n, start, pitch } : n,
            ),
          )
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
          e.preventDefault()
          deleteNote(selected)
        }
      }}
    >
      <div className="studio-toolbar flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-3">
        <Input
          key={source.id}
          aria-label="Clip name"
          data-saved-value={source.name}
          className="h-8 w-32 shrink-0 border-transparent font-medium"
          defaultValue={source.name}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== source.name)
              void update({ name: e.target.value })
          }}
        />
        <Button
          size="icon-xs"
          variant={playing ? 'secondary' : 'ghost'}
          onClick={() => {
            if (!playing && hasDraftChanges(document)) { onError('Apply pending lyric or parameter edits before playback.'); return }
            setPlaying(!playing)
          }}
          aria-label={playing ? 'Stop clip' : 'Loop clip'}
        >
          {playing && loopStage ? <Loader2 className="animate-spin" /> : playing ? <Square /> : <Play />}
        </Button>
        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
          {source.kind === 'audio'
            ? 'Audio'
            : source.kind === 'drums'
              ? 'Drums'
              : 'Piano roll'}
        </span>
        {!unlocked && (
          <span className="text-sm text-muted-foreground">
            Shared source locked
          </span>
        )}
        {source.kind !== 'audio' && (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Transpose up"
              disabled={!unlocked || parameterSaving}
              onClick={() =>
                void notes(
                  source.notes.map((n) => ({
                    ...n,
                    pitch: Math.min(127, n.pitch + 1),
                  })),
                )
              }
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Transpose down"
              disabled={!unlocked || parameterSaving}
              onClick={() =>
                void notes(
                  source.notes.map((n) => ({
                    ...n,
                    pitch: Math.max(0, n.pitch - 1),
                  })),
                )
              }
            >
              <ArrowDown />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!unlocked || parameterSaving}
              onClick={() =>
                void notes(
                  source.notes.map((n) => {
                    const start = Math.min(
                      source.duration - n.duration,
                      Math.round(n.start / step) * step,
                    )
                    return { ...n, start }
                  }),
                )
              }
            >
              Quantize
            </Button>
          </>
        )}
        {source.vocal && <>
          <Button size="sm" variant="ghost" disabled={parameterSaving} onClick={onRecordReference}>Record reference</Button>
          <VocalLyrics source={source} disabled={!unlocked || parameterSaving} update={(vocal) => update({ vocal })} />
          <VocalRenderControls project={project} source={source} disabled={parameterSaving} onError={onError} />
        </>}
        <DialogTrigger render={<Button size="sm" variant="ghost" />}
          onClick={() => setNoteEditorOpen(false)}>
          <SlidersHorizontal />
          {source.kind === 'audio' ? 'Clip settings' : source.vocal ? 'Voice' : 'Sound'}
        </DialogTrigger>
        <Button
          className="ml-auto"
          size="icon-xs"
          variant="ghost"
          aria-label="Close editor"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={canvasScroll}
          role="region"
          aria-label="Clip editor timeline"
          onContextMenu={(event) => event.preventDefault()}
          className="min-w-0 flex-1 overflow-auto overscroll-contain"
          tabIndex={0}
        >
          {source.kind === 'audio' ? (
            <div className="audio-editor-canvas relative h-full min-h-32"
              style={{ width: audioCanvasWidth }}>
              <div className="sticky top-0 z-30 h-7 border-b bg-muted" aria-label="Audio editor ruler">
                {Array.from({ length: Math.ceil(audioCanvasWidth / (scale * bar)) }, (_, index) => (
                  <span key={index} className="absolute h-7 border-l px-1 py-1 text-xs text-muted-foreground"
                    style={{ left: index * scale * bar }}>{index + 1}</span>
                ))}
              </div>
              <div className="absolute inset-x-0 top-7 bottom-0" aria-hidden="true"
                style={{ backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)',
                  backgroundSize: `${scale * bar}px 100%` }} />
              <PartCursor
                engine={engine}
                playing={playing}
                source={source}
                clip={clip}
                tempo={project.document.tempo}
                scale={audioPixelsPerSecond}
                audio
              />
              <svg
                className="absolute top-7 bottom-0 text-waveform"
                style={{ width: audioWidth, height: 'calc(100% - 28px)' }}
                viewBox={`0 0 ${audioBars} 100`}
                preserveAspectRatio="none"
                aria-label="Audio waveform"
              >
                <path d={peaks.map((peak, index) => `M${index},${50 - peak * 46}v${peak * 92}`).join('')}
                  stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          ) : (
            <div
              className="relative flex"
              style={{
                width: Math.max(600, source.duration * scale + 72),
                height:
                  pitches.length * (source.kind === 'drums' ? 32 : rowHeight) +
                  rulerHeight,
              }}
            >
              <div className="sticky left-0 z-30 w-18 shrink-0 border-r bg-muted pt-7">
                <div aria-hidden="true" className="pointer-events-none sticky top-0 z-40 -mt-7 h-7 border-b bg-muted" />
                {pitches.map((p) => (
                  <button
                    key={p}
                    disabled={source.kind === 'vocal'}
                    aria-label={`${source.kind === 'vocal' ? 'Pitch' : 'Preview'} ${source.kind === 'drums' ? (drumRows.find((r) => r.pitch === p)?.name ?? pitchName(p)) : pitchName(p)}`}
                    className={`audition-key block w-full touch-none border-b px-2 text-right text-xs ${source.kind !== 'drums' ? 'piano-key' : 'bg-muted'} ${[1, 3, 6, 8, 10].includes(p % 12) ? 'is-black' : ''}`}
                    data-octave={p % 12 === 0}
                    style={{ height: source.kind === 'drums' ? 32 : rowHeight }}
                    {...keyProps(p)}
                  >
                    {source.kind === 'drums'
                      ? (drumRows.find((r) => r.pitch === p)?.name ??
                        pitchName(p))
                      : pitchName(p)}
                  </button>
                ))}
              </div>
              <div
                className="note-grid relative flex-1 pt-7"
                onPointerDown={(e) => {
                  if (e.button !== 0 || e.target !== e.currentTarget) return
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const p =
                    pitches[
                      Math.floor(
                        (e.clientY - rect.top - rulerHeight) /
                          (source.kind === 'drums' ? 32 : rowHeight),
                      )
                    ]
                  if (p != null) add(p, (e.clientX - rect.left) / scale)
                }}
                style={{
                  '--step-width': `${scale * step}px`,
                  '--beat-width': `${scale}px`,
                  '--bar-width': `${scale * bar}px`,
                } as CSSProperties}
              >
                {pitches.map((pitch, index) => (
                  <div key={pitch} aria-hidden="true"
                    className="piano-row-band pointer-events-none absolute inset-x-0 border-b"
                    data-black={source.kind !== 'drums' && [1, 3, 6, 8, 10].includes(pitch % 12)}
                    data-octave={pitch % 12 === 0}
                    style={{ top: rulerHeight + index * (source.kind === 'drums' ? 32 : rowHeight),
                      height: source.kind === 'drums' ? 32 : rowHeight }} />
                ))}
                <PartCursor
                  engine={engine}
                  playing={playing}
                  source={source}
                  clip={clip}
                  tempo={project.document.tempo}
                  scale={scale}
                />
                <div className="piano-ruler pointer-events-none sticky top-0 z-30 -mt-7 h-7 border-b bg-muted">
                  {Array.from(
                    { length: Math.ceil(source.duration / bar) },
                    (_, i) => (
                      <span
                        className="pointer-events-none absolute inset-y-0 border-l border-foreground/25 px-1.5 py-1 text-xs text-muted-foreground"
                        key={i}
                        style={{ left: i * bar * scale, width: bar * scale }}
                      >
                        {i + 1}
                      </span>
                    ),
                  )}
                </div>
                {source.kind === 'drums'
                  ? pitches.map((p, row) =>
                      Array.from(
                        { length: Math.ceil(source.duration / step) },
                        (_, i) => {
                          const n = source.notes.find(
                            (n) =>
                              n.pitch === p &&
                              Math.abs(n.start - i * step) < 1e-5,
                          )
                          return (
                            <button
                              key={`${p}-${i}`}
                              aria-label={`${drumRows.find((r) => r.pitch === p)?.name ?? p}, step ${i + 1}`}
                              aria-pressed={!!n}
                              className={`absolute rounded-sm border ${n ? 'bg-primary border-primary' : 'bg-muted/30 border-border hover:bg-muted'}`}
                              style={{
                                left: i * step * scale + 1,
                                top: row * 32 + rulerHeight + 3,
                                width: Math.max(6, step * scale - 2),
                                height: 24,
                                opacity: n ? 0.4 + n.velocity * 0.6 : 1,
                              }}
                              onContextMenu={(event) => eraseNote(event, n)}
                              onClick={(event) => {
                                if (n) { setSelected(n.id); openNoteEditor(event.currentTarget) }
                                else add(p, i * step)
                              }}
                            />
                          )
                        },
                      ),
                    )
                  : source.notes.map((original) => {
                      const n =
                        draftNote?.id === original.id ? draftNote : original
                      return (
                        <button
                          key={n.id}
                          aria-label={`${pitchName(n.pitch)}, beat ${n.start + 1}`}
                          aria-pressed={selected === n.id}
                          onDragStart={(e) => e.preventDefault()}
                          className={`piano-note absolute z-10 touch-none rounded-sm border ${selected === n.id ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
                          style={{
                            left: n.start * scale,
                            top: rulerHeight + (high - n.pitch) * rowHeight + 1,
                            width: Math.max(6, n.duration * scale),
                            height: rowHeight - 2,
                            opacity: 0.4 + n.velocity * 0.6,
                          }}
                          onPointerDown={(e) => drag(e, n)}
                          aria-haspopup="dialog"
                          aria-expanded={selected === n.id && noteEditorOpen}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelected(n.id)
                              openNoteEditor(e.currentTarget)
                            }
                          }}
                          onContextMenu={(event) => eraseNote(event, n)}
                        >
                          {n.duration * scale >= 40 && <span className="pointer-events-none block truncate px-1 text-xs">{source.vocal ? (source.vocal.syllables[n.id]?.kind === 'continue' ? '—' : (source.vocal.syllables[n.id] as { lyric?: string })?.lyric || '…') : pitchName(n.pitch)}</span>}
                          <span className="pointer-events-none absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
                        </button>
                      )
                    })}
              </div>
            </div>
          )}
        </div>
        <DialogContent className="studio-edit-surface max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{source.kind === 'audio' ? 'Clip settings' : source.vocal ? 'Voice settings' : 'Sound settings'}</DialogTitle></DialogHeader>
          <fieldset disabled={parameterSaving} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <fieldset disabled={!unlocked} className="contents">
          {source.vocal && <>
            <VocalVoiceSettings source={source} update={(vocal) => update({ vocal })} />
            <NumberField label="Length · beats" value={source.duration} min={0.25} max={1024} step={0.25}
              onChange={(duration) => void update({ duration })} disabled={!unlocked || parameterSaving} />
          </>}
          {source.kind !== 'audio' && source.kind !== 'vocal' && (
            <>
              <label className="block space-y-1 text-sm text-muted-foreground">
                Sound
                <select
                  aria-label="Sound"
                  className={`${selectClass} w-full`}
                  value={
                    source.kind === 'drums' ? source.drum_kit : source.sound
                  }
                  disabled={!unlocked || parameterSaving}
                  onChange={(e) =>
                    void update(
                      source.kind === 'drums'
                        ? { drum_kit: e.target.value as Source['drum_kit'] }
                        : { sound: e.target.value as Source['sound'] },
                    )
                  }
                >
                  {source.kind === 'drums'
                    ? DRUM_KITS.map((k) => <option key={k}>{k}</option>)
                    : SOUND_IDS.map((s) => (
                        <option key={s} value={s}>
                          {SOUND_NAMES[s]}
                        </option>
                      ))}
                </select>
              </label>
              <NumberField
                label="Length"
                value={source.duration}
                min={0.25}
                max={1024}
                step={0.25}
                onChange={(duration) => void update({ duration })}
                disabled={!unlocked || parameterSaving}
              />
            </>
          )}
          {source.kind === 'drums' && (
            <label className="block text-sm text-muted-foreground">
              Add drum sample
              <input
                type="file"
                accept="audio/*"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  void (async () => {
                    try {
                      const buffer = await engine.import(file)
                      if (buffer.duration > 30)
                        throw new Error('Drum samples must be under 30 seconds')
                      const asset = await uploadAudio(project.id, file)
                      const pitch =
                        Array.from({ length: 128 }, (_, i) => 36 + i).find(
                          (p) =>
                            p < 128 &&
                            !source.drum_samples.some((r) => r.pitch === p),
                        ) ?? 36
                      await update({
                        drum_samples: [
                          ...source.drum_samples,
                          {
                            pitch,
                            name: file.name,
                            asset_id: asset.id,
                            gain: 1,
                          },
                        ],
                      })
                    } catch (err) {
                      onError(String(err))
                    }
                  })()
                }}
              />
            </label>
          )}
          {source.drum_samples.map((r, i) => (
            <div key={r.pitch} className="space-y-1">
              <span className="text-sm">{r.name}</span>
              <NumberField
                label="MIDI key"
                value={r.pitch}
                min={0}
                max={127}
                onChange={(pitch) =>
                  void update({
                    drum_samples: source.drum_samples.map((row, j) =>
                      j === i ? { ...row, pitch } : row,
                    ),
                  })
                }
              />
              <NumberField
                label="Level"
                value={r.gain}
                min={0}
                max={2}
                step={0.05}
                onChange={(gain) =>
                  void update({
                    drum_samples: source.drum_samples.map((row, j) =>
                      j === i ? { ...row, gain } : row,
                    ),
                  })
                }
              />
            </div>
          ))}
          {source.sampler && (
            <>
              <NumberField
                label="Root note"
                value={source.sampler.rootNote}
                min={0}
                max={127}
                onChange={(rootNote) =>
                  void update({ sampler: { ...source.sampler!, rootNote } })
                }
              />
              <label className="text-sm">
                <input
                  type="checkbox"
                  checked={source.sampler.oneShot ?? false}
                  onChange={(e) =>
                    void update({
                      sampler: {
                        ...source.sampler!,
                        oneShot: e.target.checked,
                      },
                    })
                  }
                />
                One shot
              </label>
              <NumberField
                label="Loop start · s"
                value={source.sampler.loopStart ?? 0}
                min={0}
                step={0.01}
                onChange={(loopStart) =>
                  void update({ sampler: { ...source.sampler!, loopStart } })
                }
              />
              <NumberField
                label="Loop end · s"
                value={source.sampler.loopEnd ?? 1}
                min={0.01}
                step={0.01}
                onChange={(loopEnd) =>
                  void update({ sampler: { ...source.sampler!, loopEnd } })
                }
              />
            </>
          )}
          {source.kind === 'notes' && !source.sampler && (
            <div className="space-y-2 border-t pt-3 sm:col-span-2">
              <div className="flex items-center justify-between text-sm">
                <span>Oscillators</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add oscillator"
                  disabled={
                    (source.synth.oscillators?.length ?? 0) >= 3 || !unlocked
                  }
                  onClick={() =>
                    void update({
                      synth: {
                        ...source.synth,
                        oscillators: [
                          ...(source.synth.oscillators ?? []),
                          {
                            wave: 'saw',
                            level: 0.5,
                            transpose: 0,
                            voices: 1,
                            detune: 0,
                            spread: 0.5,
                            pan: 0,
                            bypassFilter: false,
                          },
                        ],
                      },
                    })
                  }
                >
                  <Copy />
                </Button>
              </div>
              {source.synth.oscillators?.map((o, i) => {
                const change = (patch: Partial<typeof o>) =>
                  update({
                    synth: {
                      ...source.synth,
                      oscillators: source.synth.oscillators!.map((osc, j) =>
                        j === i ? { ...osc, ...patch } : osc,
                      ),
                    },
                  })
                return (
                  <div key={i} className="space-y-2 border-t pt-2">
                    <div className="flex items-center gap-1">
                      <select
                        aria-label={`Oscillator ${i + 1} wave`}
                        className={`${selectClass} flex-1`}
                        value={o.wave}
                        onChange={(e) =>
                          change({ wave: e.target.value as typeof o.wave })
                        }
                      >
                        {['saw', 'sine', 'square', 'triangle'].map((w) => (
                          <option key={w}>{w}</option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove oscillator"
                        onClick={() =>
                          void update({
                            synth: {
                              ...source.synth,
                              oscillators: source.synth.oscillators!.filter(
                                (_, j) => j !== i,
                              ),
                            },
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {(
                      [
                        'level',
                        'transpose',
                        'voices',
                        'detune',
                        'spread',
                        'pan',
                      ] as const
                    ).map((key) => (
                      <ParameterSlider
                        disabled={!unlocked || parameterSaving}
                        key={key}
                        label={key}
                        value={o[key] ?? 0}
                        min={
                          key === 'transpose'
                            ? -48
                            : key === 'pan'
                              ? -1
                              : key === 'voices'
                                ? 1
                                : 0
                        }
                        max={
                          key === 'transpose'
                            ? 48
                            : key === 'voices'
                              ? 16
                              : key === 'detune'
                                ? 100
                                : 1
                        }
                        step={['transpose', 'voices'].includes(key) ? 1 : 0.05}
                        onChange={(n) => change({ [key]: n })}
                      />
                    ))}
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        checked={o.bypassFilter ?? false}
                        onChange={(e) =>
                          change({ bypassFilter: e.target.checked })
                        }
                      />
                      Bypass filter
                    </label>
                  </div>
                )
              })}
            </div>
          )}
          {source.kind === 'notes' &&
            (
              [
                'attack',
                'decay',
                'sustain',
                'release',
                'cutoff',
                'detune',
              ] as const
            ).map((key) => (
              <ParameterSlider
                key={key}
                label={key}
                value={
                  source.synth[key] ??
                  {
                    attack: 0.01,
                    decay: 0.2,
                    sustain: 0.7,
                    release: 0.3,
                    cutoff: 12000,
                    detune: 0,
                  }[key]
                }
                min={
                  key === 'detune'
                    ? -100
                    : key === 'cutoff'
                      ? 20
                      : ['sustain', 'attack', 'release'].includes(key)
                        ? 0
                        : 0.01
                }
                max={
                  key === 'cutoff'
                    ? 20000
                    : key === 'detune'
                      ? 100
                      : key === 'sustain'
                        ? 1
                        : 5
                }
                step={key === 'cutoff' ? 10 : key === 'detune' ? 1 : 0.01}
                onChange={(v) =>
                  update({ synth: { ...source.synth, [key]: v } })
                }
                disabled={!unlocked || parameterSaving}
              />
            ))}
          </fieldset>
          {clip && (
            <fieldset disabled={instanceLocked} className="contents">
              <span className="border-t pt-3 text-sm font-medium sm:col-span-2">Clip</span>
              {(
                [
                  'offset',
                  'source_duration',
                  'gain',
                  'fade_in',
                  'fade_out',
                ] as const
              ).map((key) => (
                <NumberField
                  key={key}
                  label={key.replaceAll('_', ' ')}
                  value={clip[key] ?? source.duration}
                  min={key === 'source_duration' ? 0.01 : 0}
                  max={key === 'gain' ? 2 : source.duration}
                  step={key === 'gain' ? 0.05 : 0.25}
                  onChange={(value) => {
                    const track = project.document.tracks.find((t) =>
                      t.clips.some((c) => c.id === clip.id),
                    )!
                    void commit([
                      {
                        type: 'clip.update',
                        track_id: track.id,
                        clip_id: clip.id,
                        [key]: value,
                        ...(key === 'source_duration'
                          ? {
                              length_beats:
                                source.kind === 'audio'
                                  ? (value * project.document.tempo) / 60
                                  : value,
                            }
                          : {}),
                      },
                    ])
                  }}
                />
              ))}
            </fieldset>
          )}
          </fieldset>
        </DialogContent>
      </div>
      {source.vocal && <VocalExpression source={source} disabled={!unlocked || parameterSaving} update={(vocal) => update({ vocal })} />}
      <Dialog open={noteEditorOpen && !!note}
        onOpenChange={(open, details) => {
          if (open) return
          if (details.reason !== 'escape-key' && document.querySelector('[data-vocal-note-dirty="true"]')) {
            details.cancel()
            return
          }
          setNoteEditorOpen(false)
        }}>
        {note && <DialogContent showCloseButton={false}
          className="studio-edit-surface max-h-[85svh] overflow-y-auto sm:max-w-lg"
          finalFocus={() => noteTrigger.current?.isConnected ? noteTrigger.current : canvasScroll.current ?? false}>
          <DialogHeader className="flex-row items-center justify-between gap-2">
            <DialogTitle>{pitchName(note.pitch)}</DialogTitle>
            <Button size="icon-sm" variant="ghost" aria-label="Close note settings"
              onClick={() => setNoteEditorOpen(false)}><X /></Button>
          </DialogHeader>
          {(!unlocked) && <span className="text-xs text-muted-foreground">Shared source locked</span>}
          {source.vocal && <VocalNoteFields key={`${note.id}:${project.version}`} source={source} noteId={note.id}
            disabled={!unlocked || parameterSaving} update={(patch) => update(patch, true)}
            onApplied={() => setNoteEditorOpen(false)} />}
          <ParameterSlider label="Pitch" value={note.pitch} min={0} max={127} format={pitchName}
            disabled={!unlocked || parameterSaving}
            onChange={(pitch) => notes(source.notes.map((n) => n.id === note.id ? { ...n, pitch } : n))} />
          {!source.vocal && <ParameterSlider label="Velocity" value={note.velocity} min={0.01} max={1} step={0.01}
            format={(value) => `${Math.round(value * 100)}%`} disabled={!unlocked || parameterSaving}
            onChange={(velocity) => notes(source.notes.map((n) => n.id === note.id ? { ...n, velocity } : n))} />}
          <ParameterSlider label="Duration" value={note.duration} min={Math.min(step, source.duration - note.start)}
            max={snapNoteDuration(source.duration - note.start, source.duration - note.start)} step={step} format={formatNoteDuration}
            disabled={!unlocked || parameterSaving}
            onChange={(duration) => notes(source.notes.map((n) => n.id === note.id ? { ...n, duration: snapNoteDuration(duration, source.duration - note.start) } : n))} />
          <Button size="sm" variant="ghost" className="justify-start" disabled={!unlocked || parameterSaving}
            onClick={() => deleteNote(note.id)}>
            <Trash2 />Delete note
          </Button>
        </DialogContent>}
      </Dialog>
    </section>
    </Dialog>
  )
}

function PartCursor({
  engine,
  playing,
  source,
  clip,
  tempo,
  scale,
  audio = false,
}: {
  engine: AudioEngine
  playing: boolean
  source: Source
  clip?: Clip
  tempo: number
  scale: number
  audio?: boolean
}) {
  const cursor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const t = engine.partPosition()
      if (cursor.current) {
        cursor.current.style.visibility = t == null ? 'hidden' : 'visible'
        if (t != null) {
          const at =
            editorPlaybackClip(source, tempo, clip).offset + t * (source.kind === 'audio' ? 1 : tempo / 60)
          cursor.current.style.left = `${at * scale}px`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine, playing, source, clip, tempo, scale, audio])
  return playing ? (
    <div
      ref={cursor}
      className="pointer-events-none absolute bottom-0 z-20 w-px bg-playhead"
      style={{ top: audio ? 0 : 28 }}
    />
  ) : null
}
