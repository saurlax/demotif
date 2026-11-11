import { Check, Circle, Settings2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StudioHeaderActionsProps {
  saving: boolean
  dirty: boolean
  example: boolean
  onSettings: () => void
  recording: boolean
}

export function StudioHeaderActions({ saving, dirty, example, onSettings, recording }: StudioHeaderActionsProps) {
  const status = saving ? 'Saving…' : dirty ? 'Unsaved changes' : example ? 'Example' : 'Saved'
  return <div className="flex shrink-0 items-center gap-1.5">
    <span className={`flex items-center gap-1.5 pr-1 text-xs ${dirty ? 'text-primary' : 'text-muted-foreground'}`} title={status} aria-label={status}>
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : dirty ? <Circle className="size-2 fill-current" /> : <Check className="size-3.5" />}
      <span className="hidden xl:inline">{status}</span>
    </span>
    <Button variant="ghost" size="icon-sm" onClick={onSettings} disabled={recording}
      aria-label="Recording settings" title="Recording settings"><Settings2 /></Button>
  </div>
}
