import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, Loader2 } from 'lucide-react'
import { navigate } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Example { id: string; name: string; tempo: number; tracks: number }

export function ExamplePicker() {
  const [open, setOpen] = useState(false)
  const examples = useQuery({
    queryKey: ['examples'], enabled: open,
    queryFn: async (): Promise<Example[]> => {
      const response = await fetch('/api/projects/examples')
      if (!response.ok) throw new Error('Could not load examples.')
      return response.json()
    },
  })
  const load = useMutation({
    mutationFn: async (id: string): Promise<{ id: string }> => {
      const response = await fetch(`/api/projects/examples/${encodeURIComponent(id)}`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Could not open example.')
      return body
    },
    onSuccess: (project) => {
      navigate(`/studio/${project.id}`)
    },
  })
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) load.reset() }}>
    <DialogTrigger render={<Button variant="ghost" />}>Open example</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Example projects</DialogTitle></DialogHeader>
      <div className="max-h-[60svh] overflow-y-auto">
        {examples.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>}
        {examples.error && <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          {examples.error.message}<Button variant="outline" onClick={() => void examples.refetch()}>Retry</Button>
        </div>}
        {examples.data?.map((example) => <button key={example.id} type="button"
          disabled={load.isPending} onClick={() => load.mutate(example.id)}
          className="flex w-full items-center gap-4 border-b px-2 py-4 text-left transition-colors last:border-0 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium wrap-break-word">{example.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{example.tempo} BPM · {example.tracks} tracks</span>
          </span>
          {load.isPending && load.variables === example.id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ArrowRight className="size-4 shrink-0" />}
        </button>)}
      </div>
      {load.error && <p role="alert" className="text-sm text-destructive">{load.error.message}</p>}
    </DialogContent>
  </Dialog>
}
