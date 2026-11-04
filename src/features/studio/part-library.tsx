import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { CreateClipDialog, type CreateClipOptions, type SoundPreset } from './create-clip-dialog'
import { Plus, X, Music2, Trash2 } from 'lucide-react'
import { usePanelPresence } from '@/components/use-panel-presence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SOUND_IDS, SOUND_NAMES } from '@/audio/soundDefinitions'
import { AudioEngine } from '@/audio/audio'
import { ClipDragPreview } from './clip-drag-preview'
import { ClipPreviewContents, clipPreviewColor } from './clip-preview-card'
import type { Part, Project } from '@/types/project'
export function PartLibrary({
  open,
  project,
  engine,
  activeSourceId,
  onOpen,
  onPlace,
  onCreate,
  onRemove,
  onClose,
  onPreset,
  initialTab,
}: {
  open: boolean
  initialTab?: 'parts' | 'sounds'
  project: Project
  engine: AudioEngine
  activeSourceId?: string | null
  onOpen: (id: string) => void
  onPlace: (id: string, trackId?: string, beat?: number) => void
  onCreate: (options: CreateClipOptions) => Promise<void>
  onRemove: (id: string) => void
  onClose: () => void
  onPreset: (presetId: string, asInstrument: boolean) => void
}) {
  const [drag, setDrag] = useState<{
    part: Part; color: string; x: number; y: number
    target?: string; beat: number; marker?: { left: number; top: number; width: number; height: number }
  } | null>(null)
  const cancelDrag = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => () => cancelDrag.current?.(), [])

  function startDrag(event: React.PointerEvent, part: Part, color: string) {
    if (event.button !== 0) return
    cancelDrag.current?.()
    suppressClick.current = false
    const originX = event.clientX, originY = event.clientY, pointerId = event.pointerId
    let started = false, finished = false
    let destination: { track: string; beat: number } | undefined
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (!started && Math.hypot(e.clientX - originX, e.clientY - originY) < 4) return
      started = true
      suppressClick.current = true
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-library-track]')
      const track = project.document.tracks.find((t) => t.id === lane?.dataset.libraryTrack)
      const scale = Number(lane?.dataset.timelineScale)
      const scroller = lane?.closest('.arrangement-scroll')
      const viewport = scroller?.getBoundingClientRect()
      if (scroller && viewport) {
        if (e.clientX > viewport.right - 30) scroller.scrollLeft += 16
        if (e.clientX < viewport.left + 238) scroller.scrollLeft -= 16
      }
      const bounds = lane?.getBoundingClientRect()
      const beat = bounds && scale ? Math.max(0, Math.round(((e.clientX - bounds.left) / scale) * 4) / 4) : 0
      destination = track && !track.locked ? { track: track.id, beat } : undefined
      const source = project.document.sources.find((s) => s.id === part.source_id)
      const beats = source?.kind === 'audio' ? part.duration * project.document.tempo / 60 : part.duration
      setDrag({ part, color, x: e.clientX, y: e.clientY,
        target: destination?.track, beat,
        marker: destination && bounds && viewport ? {
          left: bounds.left + beat * scale, top: bounds.top + 4,
          width: Math.max(0, Math.min(beats * scale, viewport.right - bounds.left - beat * scale)), height: bounds.height - 8,
        } : undefined,
      })
    }
    const finish = (cancelled: boolean) => {
      if (finished) return
      finished = true
      cancelDrag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', visibility)
      setDrag(null)
      if (!cancelled && started && destination) onPlace(part.id, destination.track, destination.beat)
    }
    const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(false) }
    const cancel = () => finish(true)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }
    const visibility = () => { if (document.hidden) cancel() }
    cancelDrag.current = cancel
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', visibility)
  }
  const present = usePanelPresence(open)
  useEffect(() => { if (!open) cancelDrag.current?.() }, [open])
  const [width, setWidth] = useState(224)
  const { data: catalog = [], isPending: catalogLoading, isError: catalogError, refetch } = useQuery({
    queryKey: ['built-in-sounds'],
    queryFn: async (): Promise<SoundPreset[]> => {
      const response = await fetch('/api/sounds')
      if (!response.ok) throw new Error('Could not load sounds')
      return (await response.json()).entries
    },
  })
  const [tab, setTab] = useState<'parts' | 'sounds'>(initialTab ?? 'parts'),
    [search, setSearch] = useState('')
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  if (!present) return null
  return (
    <div className="studio-side-panel studio-library-shell relative z-[44] shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0"
      data-side="left" data-state={open ? 'open' : 'closed'} inert={!open}
      style={{ '--panel-width': `${width}px` } as CSSProperties}>
    <aside
      aria-label="Clip library"
      data-library-drop="true"
      style={{ width }}
      className="studio-side-panel-content studio-library studio-edit-surface relative flex h-full shrink-0 flex-col border-r bg-background"
    >
      <div className="studio-toolbar flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-sm font-medium">Library</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close library"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="flex gap-1 p-2">
        <Button
          size="sm"
          aria-pressed={tab === 'parts'}
          variant={tab === 'parts' ? 'secondary' : 'ghost'}
          onClick={() => setTab('parts')}
        >
          Clips
        </Button>
        <Button
          size="sm"
          aria-pressed={tab === 'sounds'}
          variant={tab === 'sounds' ? 'secondary' : 'ghost'}
          onClick={() => setTab('sounds')}
        >
          Sounds
        </Button>
      </div>
      <div className="flex items-center gap-1 px-2 pb-2">
        <Input
          className="h-8 min-w-0 flex-1"
          aria-label="Search library"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CreateClipDialog catalog={catalog} loading={catalogLoading} catalogError={catalogError}
          onRetry={() => void refetch()} onCreate={async (options) => {
            await onCreate(options)
            setTab('parts')
            setSearch('')
          }} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {tab === 'parts'
          ? project.document.parts
              .filter((p) =>
                p.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => {
                const color = clipPreviewColor(project, p.source_id)
                return (
                  <div
                    key={p.id}
                    onDragStart={(e) => e.preventDefault()}
                    data-dragging={drag?.part.id === p.id}
                    className="library-clip-card group relative mb-2 overflow-hidden rounded-md border"
                    data-selected={activeSourceId === p.source_id}
                    style={{ '--clip-color': color } as CSSProperties}
                  >
                    <button
                      className="block w-full min-w-0 touch-none cursor-grab text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
                      aria-label={`Open ${p.name}`}
                      aria-pressed={activeSourceId === p.source_id}
                      onPointerDown={(event) => startDrag(event, p, color)}
                      onClick={(event) => {
                        if (suppressClick.current && event.detail !== 0) { event.preventDefault(); return }
                        onOpen(p.source_id)
                      }}
                    >
                      <ClipPreviewContents project={project} engine={engine}
                        clip={{ name: p.name, source_id: p.source_id, offset: p.offset,
                          source_duration: p.duration, length_beats: p.duration }} />
                    </button>
                    <div className="library-clip-actions absolute top-0 right-0 flex">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Place ${p.name}`}
                        onClick={() => onPlace(p.id)}
                      >
                        <Plus />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => onRemove(p.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                )
              })
          : (catalog.length
              ? catalog
              : SOUND_IDS.map((id) => ({
                  id,
                  name: SOUND_NAMES[id],
                  kind: 'keys',
                  category: 'Synth',
                }))
            )
              .filter((s) =>
                s.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((s) => (
                <div className="mb-1 flex items-center" key={s.id}>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted"
                    onClick={() => onPreset(s.id, false)}
                  >
                    <Music2 className="size-4 shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </button>
                  {s.kind === 'import' && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Use ${s.name} as instrument`}
                      onClick={() => onPreset(s.id, true)}
                    >
                      <Plus />
                    </Button>
                  )}
                </div>
              ))}
        {tab === 'parts' && !project.document.parts.length && (
          <p className="p-2 text-sm text-muted-foreground">No clips yet.</p>
        )}
      </div>
      {drag && createPortal(<>
        {drag.marker && <div className="pointer-events-none fixed z-80 rounded-sm border-2 border-dashed border-primary bg-primary/10"
          aria-hidden="true" style={drag.marker} />}
      </>, document.body)}
      {drag && <ClipDragPreview project={project} engine={engine} x={drag.x} y={drag.y} color={drag.color}
        clip={{ name: drag.part.name, source_id: drag.part.source_id, offset: drag.part.offset,
          source_duration: drag.part.duration, length_beats: drag.part.duration }} />}
      <div
        role="separator"
        aria-label="Resize library"
        className="absolute inset-y-0 right-0 z-20 hidden w-1 cursor-col-resize hover:bg-border md:block"
        onPointerDown={(e) => {
          const x = e.clientX,
            initial = width
          const move = (ev: PointerEvent) =>
            setWidth(Math.max(176, Math.min(400, initial + ev.clientX - x)))
          const end = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end, { once: true })
        }}
      />
    </aside>
    </div>
  )
}
