import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Source } from '@/types/project'
import { selectClass } from './controls'

export interface SoundPreset {
  id: string
  name: string
  kind: string
  category: string
}

export interface CreateClipOptions {
  kind: Source['kind']
  presetId: string
  name: string
  duration: number
}

export function presetsForType(catalog: SoundPreset[], kind: Source['kind']) {
  return catalog.filter((preset) => kind === 'drums' ? preset.kind === 'drums'
    : kind === 'audio' ? preset.kind === 'import'
      : preset.kind !== 'drums' && (preset.kind !== 'import' || preset.category === '采样乐器'))
}

export function CreateClipDialog({ catalog, loading, catalogError, onRetry, onCreate }: {
  catalog: SoundPreset[]
  loading: boolean
  catalogError: boolean
  onRetry: () => void
  onCreate: (options: CreateClipOptions) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Source['kind']>('notes')
  const [presetId, setPresetId] = useState('piano')
  const [name, setName] = useState('')
  const [duration, setDuration] = useState(16)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const presets = presetsForType(catalog, kind)
  const preset = presets.find((item) => item.id === presetId) ?? presets[0]

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending) return
      setOpen(next)
      if (next) setError('')
    }}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0" />}
        aria-label="Create clip" title="Create clip"><Plus /></DialogTrigger>
      <DialogContent showCloseButton={!pending} className="max-h-[85svh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create clip</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          if (!preset || pending) return
          setPending(true)
          setError('')
          void onCreate({ kind, presetId: preset.id, name: name.trim() || preset.name, duration })
            .then(() => { setOpen(false); setName('') })
            .catch((e) => setError(e instanceof Error ? e.message : 'Could not create clip.'))
            .finally(() => setPending(false))
        }}>
          <fieldset disabled={pending} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-clip-type">Type</Label>
              <select id="create-clip-type" className={`${selectClass} w-full`} value={kind}
                onChange={(event) => { setKind(event.target.value as Source['kind']); setPresetId('') }}>
                <option value="notes">Instrument</option>
                <option value="drums">Drums</option>
                <option value="audio">Audio sample</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-clip-sound">{kind === 'drums' ? 'Drum kit' : kind === 'audio' ? 'Sample' : 'Sound'}</Label>
              <select id="create-clip-sound" className={`${selectClass} w-full`} value={preset?.id ?? ''}
                disabled={loading || !presets.length} onChange={(event) => setPresetId(event.target.value)}>
                {loading && <option value="">Loading sounds…</option>}
                {[...new Set(presets.map((item) => item.category))].map((category) => (
                  <optgroup key={category} label={category}>
                    {presets.filter((item) => item.category === category).map((item) =>
                      <option key={item.id} value={item.id}>{item.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-clip-name">Name</Label>
              <Input id="create-clip-name" value={name} placeholder={preset?.name ?? 'Untitled'}
                onChange={(event) => setName(event.target.value)} maxLength={200} />
            </div>
            {kind !== 'audio' && <div className="space-y-1.5">
              <Label htmlFor="create-clip-length">Length · beats</Label>
              <Input id="create-clip-length" type="number" className="text-base md:text-base"
                required min={0.25} max={1024} step={0.25} value={duration}
                onChange={(event) => setDuration(Number(event.target.value))} />
            </div>}
          </fieldset>
          {catalogError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            Could not load sounds.<Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || loading || !preset || catalogError}>
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}Create clip
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
