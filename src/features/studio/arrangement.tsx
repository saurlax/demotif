import { useRef, useState, type CSSProperties } from 'react'
import { ClipDragPreview } from './clip-drag-preview'
import { ClipNotePreview } from './clip-note-preview'
import { AudioPreview, clipPreviewColor, trackAccent } from './clip-preview-card'
import {
  Lock,
  LockOpen,
  Plus,
  Minus,
  Maximize,
  Scissors,
  Copy,
  Trash2,
  LocateFixed,
} from 'lucide-react'
import { AudioEngine } from '@/audio/audio'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/stores/studio'
import { beatsPerBar } from '@/audio/adapter'
import type { Project, ProducerCommand, Clip, Track } from '@/types/project'

const HEIGHT = 56
const BASE_SCALE = 28
const MIN_SCALE = 8
const MAX_SCALE = 112
export function Playhead({ scale }: { scale: number }) {
  const position = useStudioStore((s) => s.positionBeats)
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20 w-px bg-playhead"
      style={{ left: position * scale }}
    >
      <div className="-ml-1 size-2 rotate-45 bg-playhead" />
    </div>
  )
}
export function Arrangement({
  project,
  commit,
  onSelect,
  onSeek,
  onTrack,
  onPlace,
  engine,
}: {
  project: Project
  engine: AudioEngine
  commit: (commands: ProducerCommand[]) => Promise<void>
  onSelect: (trackId: string, clipId: string) => void
  onSeek: (beat: number) => void
  onTrack: (trackId: string) => void
  onPlace: (partId: string, trackId: string, beat: number) => void
}) {
  const [scale, setScale] = useState(BASE_SCALE),
    [follow, setFollow] = useState(false),
    [scrubbing, setScrubbing] = useState(false)
  const [drag, setDrag] = useState<{
    clip: Clip
    track: Track
    left: number
    width: number
    target: string
    edge: 'move' | 'right' | 'left'
    x: number
    y: number
    returning: boolean
    valid: boolean
    settling?: boolean
  } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const scrubActive = useRef(false)
  const cancelGesture = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelGesture.current?.(), [])
  const selected = useStudioStore((s) => s.selectedClipId)
  const tracks = project.document.tracks,
    bar = beatsPerBar(project.document.time_signature)
  const end = Math.max(
    32,
    ...tracks.flatMap((t) => t.clips.map((c) => c.start_beat + c.length_beats)),
    ...project.document.sections.map((section) => section.start + section.duration),
  )
  const width = Math.max(800, (Math.ceil(end / bar) * bar + bar * 4) * scale)
  const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === selected),
    track = tracks.find((t) => t.clips.some((c) => c.id === selected))
  const position = useStudioStore.getState().positionBeats
  function scrub(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    cancelGesture.current?.()
    const ruler = event.currentTarget
    const pointerId = event.pointerId
    let pointerX = event.clientX, frame = 0, finished = false
    scrubActive.current = true
    setScrubbing(true)
    const seek = () => {
      const left = ruler.getBoundingClientRect().left
      const beat = Math.max(0, Math.min(width / scale, Math.round((pointerX - left) / scale * 4) / 4))
      onSeek(beat)
    }
    seek()
    let last = performance.now()
    const tick = (now: number) => {
      const el = scroll.current
      if (el) {
        const bounds = el.getBoundingClientRect()
        const dt = Math.min(40, now - last)
        const direction = pointerX > bounds.right - 28 ? 1 : pointerX < bounds.left + 208 + 28 ? -1 : 0
        const before = el.scrollLeft
        el.scrollLeft += direction * dt * .6
        if (el.scrollLeft !== before) seek()
      }
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      e.preventDefault()
      pointerX = e.clientX
      seek()
    }
    const finish = () => {
      if (finished) return
      finished = true
      cancelGesture.current = null
      cancelAnimationFrame(frame)
      scrubActive.current = false
      setScrubbing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      window.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', visibility)
    }
    const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish() } }
    const visibility = () => { if (document.hidden) finish() }
    cancelGesture.current = finish
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    window.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', visibility)
  }
  function gesture(
    event: React.PointerEvent,
    clip: Clip,
    track: Track,
    edge: 'move' | 'right' | 'left',
  ) {
    if (event.button !== 0 || track.locked || clip.locked) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    cancelGesture.current?.()
    onSelect(track.id, clip.id)
    const scrollStart = scroll.current?.scrollLeft ?? 0
    const x = event.clientX,
      original = clip.start_beat
    let delta = 0,
      returning = false,
      target = track.id,
      cancelled = false,
      started = false,
      finished = false,
      valid = true
    const move = (e: PointerEvent) => {
      if (!started && Math.hypot(e.clientX - x, e.clientY - event.clientY) < 4) return
      started = true
      e.preventDefault()
      const bounds = scroll.current?.getBoundingClientRect()
      if (scroll.current && bounds) {
        if (e.clientX > bounds.right - 30) scroll.current.scrollLeft += 16
        if (e.clientX < bounds.left + 208 + 30) scroll.current.scrollLeft -= 16
      }
      delta = Math.round(((e.clientX - x + (scroll.current?.scrollLeft ?? 0) - scrollStart) / scale) * 4) / 4
      if (edge === 'move') delta = Math.max(-original, delta)
      if (edge === 'right') delta = Math.max(0.25 - clip.length_beats, delta)
      if (edge === 'left')
        delta = Math.max(
          -clip.start_beat,
          -clip.offset /
            (project.document.sources.find((s) => s.id === clip.source_id)
              ?.kind === 'audio'
              ? 60 / project.document.tempo
              : 1),
          Math.min(clip.length_beats - 0.25, delta),
        )
      returning = edge === 'move' && !!document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-library-drop]')
      const row = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-track]')
        ?.getAttribute('data-track')
      if (row && edge === 'move') target = row
      valid = returning ? !!clip.source_id
        : edge !== 'move' || (!!row && !tracks.find((t) => t.id === target)?.locked)
      setDrag({
        clip,
        track,
        left: edge === 'right' ? original : original + delta,
        width:
          edge === 'move'
            ? clip.length_beats
            : clip.length_beats + (edge === 'left' ? -delta : delta),
        target,
        edge,
        x: e.clientX,
        y: e.clientY,
        returning,
        valid,
      })
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      if (cancelled || !started || !valid) {
        setDrag(null)
        return
      }
      setDrag((state) => state ? { ...state, settling: true } : null)
      if (returning && clip.source_id) {
        const source = project.document.sources.find(
          (s) => s.id === clip.source_id,
        )!
        const duration =
          clip.source_duration ??
          clip.length_beats *
            (source.kind === 'audio' ? 60 / project.document.tempo : 1)
        const saved = project.document.parts.some(
          (p) =>
            p.source_id === source.id &&
            p.offset === clip.offset &&
            p.duration === duration,
        )
        void commit([
          ...(saved
            ? []
            : [
                {
                  type: 'part.add' as const,
                  part: {
                    id: crypto.randomUUID(),
                    name: clip.name,
                    source_id: source.id,
                    offset: clip.offset,
                    duration,
                  },
                },
              ]),
          { type: 'clip.remove', track_id: track.id, clip_id: clip.id },
        ]).finally(() => setDrag(null))
        return
      }
      if (!delta && target === track.id) { setDrag(null); return }
      const source = project.document.sources.find(
          (s) => s.id === clip.source_id,
        ),
        unit =
          source?.kind === 'audio' || (!source && clip.asset_id)
            ? 60 / project.document.tempo
            : 1
      const windowLength = clip.source_duration ?? clip.length_beats * unit
      const update: ProducerCommand = {
        type: 'clip.update',
        track_id: track.id,
        clip_id: clip.id,
        ...(edge === 'move'
          ? { start_beat: original + delta, target_track_id: target }
          : {
              length_beats:
                clip.length_beats + (edge === 'left' ? -delta : delta),
              source_duration:
                windowLength + (edge === 'left' ? -delta : delta) * unit,
              ...(edge === 'left'
                ? {
                    start_beat: original + delta,
                    offset: clip.offset + delta * unit,
                    envelope_offset: clip.envelope_offset + delta * unit,
                    envelope_duration: clip.envelope_duration ?? windowLength,
                  }
                : {}),
            }),
      }
      void commit([update]).finally(() => setDrag(null))
    }
    cancelGesture.current = cancel
    window.addEventListener('pointercancel', cancel, { once: true })
    window.addEventListener('blur', cancel, { once: true })
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('keydown', key)
  }
  return (
    <section
      className="studio-arrangement studio-edit-surface flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      aria-label="Arrangement"
    >
      <div className="studio-toolbar flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!clip || !track}
          onClick={() =>
            clip &&
            track &&
            void commit([
              {
                type: 'clip.split',
                track_id: track.id,
                clip_id: clip.id,
                at_beat:
                  position > clip.start_beat &&
                  position < clip.start_beat + clip.length_beats
                    ? position
                    : clip.start_beat + clip.length_beats / 2,
              },
            ])
          }
          aria-label="Split clip"
        >
          <Scissors />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!clip || !track}
          onClick={() =>
            clip &&
            track &&
            void commit([
              {
                type: 'clip.add',
                id: crypto.randomUUID(),
                track_id: track.id,
                name: clip.name,
                kind: clip.kind,
                start_beat: clip.start_beat + clip.length_beats,
                length_beats: clip.length_beats,
                source_id: clip.source_id ?? undefined,
                asset_id: clip.asset_id,
                offset: clip.offset,
                source_duration: clip.source_duration ?? undefined,
              },
            ])
          }
          aria-label="Duplicate clip"
        >
          <Copy />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!clip || !track}
          onClick={() =>
            clip &&
            track &&
            void commit([
              { type: 'clip.remove', track_id: track.id, clip_id: clip.id },
            ])
          }
          aria-label="Delete clip"
        >
          <Trash2 />
        </Button>
        <div role="group" aria-label="Timeline view" className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setScale(Math.max(MIN_SCALE, scale / 1.3))}
            aria-label="Zoom out"
            disabled={scale <= MIN_SCALE}
          >
            <Minus />
          </Button>
          <output aria-label="Timeline zoom" aria-live="polite"
            className="min-w-14 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round((scale / BASE_SCALE) * 100)}%
          </output>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setScale(Math.min(MAX_SCALE, scale * 1.3))}
            aria-label="Zoom in"
            disabled={scale >= MAX_SCALE}
          >
            <Plus />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() =>
              setScale(
                Math.min(MAX_SCALE, Math.max(
                  MIN_SCALE,
                  ((scroll.current?.clientWidth ?? 1000) - 208) / (end + bar),
                )),
              )
            }
            aria-label="Fit arrangement"
          >
            <Maximize />
          </Button>
          <Button
            size="icon-xs"
            variant={follow ? 'secondary' : 'ghost'}
            onClick={() => setFollow(!follow)}
            aria-label="Follow playhead"
            aria-pressed={follow}
          >
            <LocateFixed />
          </Button>
        </div>
      </div>
      <div
        ref={scroll}
        className="arrangement-scroll relative min-h-0 flex-1 overflow-auto"
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return
          if ((e.key === 'Delete' || e.key === 'Backspace') && clip && track) {
            e.preventDefault()
            void commit([
              { type: 'clip.remove', track_id: track.id, clip_id: clip.id },
            ])
          }
        }}
        tabIndex={0}
      >
        <Follow enabled={follow && !drag && !scrubbing} scale={scale} container={scroll} suspended={scrubActive} />
        <div style={{ minWidth: width + 208 }}>
          <div className={`sticky top-0 z-40 flex bg-background border-b ${project.document.sections.length ? 'h-16' : 'h-8'}`}>
            <div className="sticky left-0 z-40 flex w-52 shrink-0 items-end border-r bg-background px-3 py-2 text-xs text-muted-foreground">
              Tracks
            </div>
            <div
              className="relative flex-1 touch-none cursor-ew-resize"
              aria-label="Timeline ruler"
              onPointerDown={scrub}
            >
              {project.document.sections.map((section) => (
                <span key={section.id} className="timeline-section pointer-events-none absolute top-0 flex h-8 items-center overflow-hidden border-b border-l px-2 text-xs font-medium"
                  aria-label={`${section.name}, bars ${Math.floor(section.start / bar + 1e-7) + 1}–${Math.ceil((section.start + section.duration) / bar - 1e-7)}`}
                  style={{ left: section.start * scale, width: section.duration * scale,
                    '--section-color': section.color } as CSSProperties}>
                  <span className="truncate">{section.name}</span>
                </span>
              ))}
              {Array.from(
                { length: Math.ceil(width / (bar * scale)) },
                (_, i) => (
                  <span
                    key={i}
                    className="absolute border-l px-1 py-2 text-xs text-muted-foreground"
                    style={{ left: i * bar * scale, top: project.document.sections.length ? 32 : 0 }}
                  >
                    {i + 1}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="relative">
            {tracks.map((t, trackIndex) => (
              <div
                className="flex"
                key={t.id}
                data-track={t.id}
                style={{ height: HEIGHT }}
              >
                <div className="track-header sticky left-0 z-30 flex w-52 shrink-0 items-center gap-1 border-r border-b bg-background px-2"
                  style={{ '--track-color': trackAccent(t, project, trackIndex) } as CSSProperties}>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onTrack(t.id)}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className="track-color-dot" aria-hidden="true" />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.clips.length} {t.clips.length === 1 ? 'clip' : 'clips'}
                    </span>
                  </button>
                  <button
                    aria-pressed={t.muted}
                    className={`track-toggle size-8 rounded text-sm ${t.muted ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                    aria-label={`Mute ${t.name}`}
                    onClick={() =>
                      void commit([
                        {
                          type: 'track.update',
                          track_id: t.id,
                          muted: !t.muted,
                        },
                      ])
                    }
                  >
                    M
                  </button>
                  <button
                    aria-pressed={t.solo}
                    className={`track-toggle size-8 rounded text-sm ${t.solo ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                    aria-label={`Solo ${t.name}`}
                    onClick={() =>
                      void commit([
                        { type: 'track.update', track_id: t.id, solo: !t.solo },
                      ])
                    }
                  >
                    S
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t.locked ? 'Unlock track' : 'Lock track'}
                    onClick={() =>
                      void commit([
                        {
                          type: 'track.set_lock',
                          track_id: t.id,
                          locked: !t.locked,
                        },
                      ])
                    }
                  >
                    {t.locked ? <Lock /> : <LockOpen />}
                  </Button>
                </div>
                <div
                  className="track-lane relative flex-1 border-b"
                  data-library-track={t.id}
                  data-timeline-scale={scale}
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, var(--border) 1px, transparent 1px)',
                    backgroundSize: `${scale * bar}px 100%`,
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/part'))
                      e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    onPlace(
                      e.dataTransfer.getData('application/part'),
                      t.id,
                      Math.max(
                        0,
                        Math.round(
                          (e.clientX -
                            e.currentTarget.getBoundingClientRect().left) /
                            scale,
                        ),
                      ),
                    )
                  }}
                >
                  {t.clips.map((c) => {
                    const s = project.document.sources.find(
                      (s) => s.id === c.source_id,
                    )
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        data-selected={selected === c.id}
                        aria-label={`${c.name}, ${c.length_beats} beats`}
                        onClick={() => onSelect(t.id, c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSelect(t.id, c.id)
                        }}
                        onPointerDown={(e) => gesture(e, c, t, 'move')}
                        onDragStart={(e) => e.preventDefault()}
                        className={`studio-clip absolute top-1 flex h-12 touch-none flex-col overflow-hidden rounded-sm border text-left ${drag?.clip.id === c.id ? 'opacity-25' : ''} ${c.locked || t.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${selected === c.id ? 'ring-1 ring-primary border-primary' : 'border-border'}`}
                        style={{
                          left: c.start_beat * scale,
                          width: Math.max(16, c.length_beats * scale),
                          '--clip-color': c.color ?? trackAccent(t, project, trackIndex),
                        } as CSSProperties}
                      >
                        <div className="clip-heading truncate border-b border-border/60 px-1 text-sm font-medium">
                          {c.name}
                        </div>
                        <div className="pointer-events-none min-h-0 flex-1 overflow-hidden px-1 text-xs text-foreground/65">
                          {s?.notes.length ? (
                            <ClipNotePreview notes={s.notes} offset={c.offset}
                              duration={c.source_duration ?? c.length_beats} />
                          ) : s?.kind === 'audio' || c.asset_id ? (
                            <AudioPreview
                              project={project}
                              clip={c}
                              engine={engine}
                            />
                          ) : (
                            'Empty clip'
                          )}
                        </div>
                        <div
                          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            gesture(e, c, t, 'left')
                          }}
                        />
                        <div
                          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            gesture(e, c, t, 'right')
                          }}
                        />
                      </div>
                    )
                  })}
                  {drag?.target === t.id && !drag.returning && (
                    <div
                      className={`clip-drop-preview pointer-events-none absolute top-1 h-12 rounded-sm border-2 border-dashed ${drag.valid ? 'border-primary bg-primary/10' : 'border-destructive bg-destructive/10'}`}
                      aria-hidden="true"
                      style={{
                        left: drag.left * scale,
                        width: drag.width * scale,
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
            {!tracks.length && (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Add a track or a clip to start.
              </div>
            )}
            <div className="pointer-events-none absolute inset-y-0 left-52 right-0">
              <Playhead scale={scale} />
            </div>
          </div>
        </div>
      </div>
      {drag && drag.edge === 'move' && !drag.settling && (
        <ClipDragPreview project={project} clip={drag.clip} engine={engine} x={drag.x} y={drag.y}
          color={clipPreviewColor(project, drag.clip.source_id, drag.track, drag.clip.color)}
          invalid={!drag.valid} trailing={drag.returning ? 'Move to library' : undefined} />
      )}
    </section>
  )
}
import { useEffect } from 'react'
function Follow({
  enabled,
  scale,
  container,
  suspended,
}: {
  suspended: React.RefObject<boolean>
  enabled: boolean
  scale: number
  container: React.RefObject<HTMLDivElement | null>
}) {
  useEffect(() => {
    if (!enabled) return
    const center = () => {
      const el = container.current
      if (!el || suspended.current) return
      const position = useStudioStore.getState().positionBeats
      el.scrollLeft = Math.max(0, position * scale - Math.max(0, el.clientWidth - 208) / 2)
    }
    center()
    const unsubscribe = useStudioStore.subscribe((state, previous) => {
      if (state.positionBeats !== previous.positionBeats) center()
    })
    const observer = new ResizeObserver(center)
    if (container.current) observer.observe(container.current)
    return () => { unsubscribe(); observer.disconnect() }
  }, [enabled, scale, container, suspended])
  return null
}
