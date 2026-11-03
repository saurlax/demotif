import { Circle, Pause, Play, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useStudioStore } from '@/stores/studio'
import type { Project } from '@/types/project'

interface TransportBarProps {
  project: Project
}

export function TransportBar({ project }: TransportBarProps) {
  const playing = useStudioStore((state) => state.playing)
  const positionBeats = useStudioStore((state) => state.positionBeats)
  const togglePlayback = useStudioStore((state) => state.togglePlayback)
  const stop = useStudioStore((state) => state.stop)

  const bar = Math.floor(positionBeats / 4) + 1
  const beat = Math.floor(positionBeats % 4) + 1

  return (
    <footer className="@container flex h-14 shrink-0 items-center gap-2 whitespace-nowrap border-t border-border/80 bg-card/60 px-2">
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="icon-sm" onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={stop} aria-label="Stop">
          <Square />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label="Record"
          title="Recording arrives with the audio engine"
        >
          <Circle className="text-destructive" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="font-mono text-sm tabular-nums">
        {bar}.{beat}
        <span className="ml-1 text-[10px] text-muted-foreground">bar.beat</span>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="font-mono text-sm tabular-nums">{project.document.tempo}</span>
        <span className="text-[10px] text-muted-foreground">BPM</span>
      </div>

      <div className="font-mono text-xs text-muted-foreground">{project.document.time_signature}</div>

      <div className="ml-auto hidden text-[10px] text-muted-foreground @3xl:block">
        Transport drives the visual playhead only — audio engine not wired yet.
      </div>
    </footer>
  )
}
