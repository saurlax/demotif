import { CloudOff, Redo2, Share2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Project } from '@/types/project'

interface TopBarProps {
  project: Project
  onUndo: () => void
  undoPending: boolean
  canUndo: boolean
}

export function TopBar({ project, onUndo, undoPending, canUndo }: TopBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-card/60 px-3 backdrop-blur">
      <Sparkles className="size-4 text-primary" />
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{project.name}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 pr-2 text-xs text-muted-foreground sm:flex">
          <CloudOff className="size-3.5" />
          Stored locally
        </span>
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onUndo}
          disabled={!canUndo || undoPending}
          aria-label="Undo"
          title="Undo last change"
        >
          <Redo2 className="rotate-180" />
        </Button>
        <Button variant="outline" size="sm" disabled title="Rendering arrives with the audio engine">
          <Share2 />
          Export
        </Button>
      </div>
    </div>
  )
}
