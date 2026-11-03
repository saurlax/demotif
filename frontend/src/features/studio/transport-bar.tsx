import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Square, Loader2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/stores/studio'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import type { Project } from '@/types/project'
export function TransportBar({
  project,
  preparing,
  onTempo,
  onTimeSignature,
}: {
  project: Project
  preparing: boolean
  onTempo: (n: number) => void
  onTimeSignature: (signature: string) => void
}) {
  const playing = useStudioStore((s) => s.playing),
    position = useStudioStore((s) => s.positionBeats)
  const centiseconds = Math.floor(position * 60 / project.document.tempo * 100)
  const elapsed = `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
  return (
    <div role="group" aria-label="Playback controls" className="studio-transport flex max-w-full shrink-0 flex-wrap items-center justify-center gap-1">
      <Button
        className="studio-play"
        data-playing={playing}
        variant="secondary"
        size="icon-sm"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => useStudioStore.getState().togglePlayback()}
      >
        {preparing ? (
          <Loader2 className="animate-spin" />
        ) : (
          <span key={playing ? 'pause' : 'play'} className="transport-symbol">
            {playing ? <Pause /> : <Play />}
          </span>
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Stop"
        onClick={() => useStudioStore.getState().stop()}
      >
        <Square />
      </Button>
      <span aria-label="Playback time" className="transport-position mx-1 min-w-[8ch] font-mono text-sm tabular-nums">
        {elapsed}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <TempoControl value={project.document.tempo} onChange={onTempo} />
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Edit time signature, ${project.document.time_signature}`}
            render={<Button variant="ghost" className="h-8 w-20 gap-1 font-mono text-base" />}>
            {project.document.time_signature}<ChevronDown className="size-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-28 max-h-72" align="end">
            <DropdownMenuRadioGroup value={project.document.time_signature} onValueChange={onTimeSignature}>
              {[...new Set(['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '3/8', '6/8', '7/8', '9/8', '12/8', project.document.time_signature])].map((signature) => (
                <DropdownMenuRadioItem key={signature} value={signature} className="min-h-8 font-mono text-base">{signature}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}


function TempoControl({ value, onChange }: { value: number; onChange: (tempo: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const finished = useRef(false)
  const restoreFocus = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false
      button.current?.focus()
    }
  }, [editing])
  const finish = (cancel: boolean, keyboard = false) => {
    if (finished.current) return
    finished.current = true
    restoreFocus.current = keyboard
    setEditing(false)
    const tempo = Math.round(Number(draft) * 10) / 10
    if (!cancel && draft.trim() && Number.isFinite(tempo) && tempo >= 20 && tempo <= 300 && tempo !== value)
      onChange(tempo)
  }
  return editing ? (
    <label className="flex h-8 w-30 shrink-0 items-center gap-2 text-sm">
      <span className="text-muted-foreground">BPM</span>
      <Input aria-label="BPM" type="number" min={20} max={300} step={0.1}
        className="h-8 min-w-0 flex-1 font-mono text-base md:text-base" autoFocus
        data-saved-value={value} value={draft} onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(event.key === 'Escape', true)
          }
        }} />
    </label>
  ) : (
    <Button ref={button} variant="ghost" className="h-8 w-30 justify-start gap-2 px-2" title="Edit tempo"
      aria-label={`Edit tempo, ${value} BPM`} onClick={() => {
        finished.current = false
        setDraft(String(value))
        setEditing(true)
      }}>
      <span className="text-muted-foreground">BPM</span><span className="font-mono text-base tabular-nums">{value}</span>
    </Button>
  )
}
