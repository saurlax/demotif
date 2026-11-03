import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, Loader2, Piano, Play, Square } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AudioEngine, waveform } from '@/audio/audio'
import type { Asset } from '@/audio/model'
import { selectClass } from '@/features/studio/controls'

interface LibraryEntry {
  id: string
  name: string
  category: string
  kind: Asset['kind']
  sound?: Asset['sound']
  drum_kit?: Asset['drumKit']
  duration?: number
  preview_url?: string
  source?: { credit: string; license: string }
}

// One preview engine across library routes; browsing never creates a project.
const previewEngine = new AudioEngine()

export function LibraryPage({ kind }: { kind: 'audio' | 'instruments' }) {
  const title = kind === 'audio' ? 'Audio' : 'Instruments'
  const Icon = kind === 'audio' ? AudioLines : Piano
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [waveforms, setWaveforms] = useState<Record<string, { peaks: number[]; duration: number }>>({})
  const waveformId = useId()
  const [progress, setProgress] = useState(0)
  const animation = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['built-in-sounds'],
    queryFn: async (): Promise<LibraryEntry[]> => {
      const response = await fetch('/api/sounds')
      if (!response.ok) throw new Error('Could not load the library.')
      return (await response.json()).entries
    },
  })

  function stop() {
    generation.current++
    clearTimeout(timer.current)
    if (animation.current !== undefined) cancelAnimationFrame(animation.current)
    setProgress(0)
    previewEngine.stopAudition()
    setActive(null)
    setLoading(false)
  }

  useEffect(() => {
    setSearch('')
    setCategory('all')
    setPreviewError('')
    setActive(null)
    setLoading(false)
    const previewGeneration = generation
    return () => {
      previewGeneration.current++
      clearTimeout(timer.current)
      if (animation.current !== undefined) cancelAnimationFrame(animation.current)
      previewEngine.stopAudition()
      previewEngine.release()
    }
  }, [kind])

  useEffect(() => {
    if (kind !== 'audio' || !data) return
    let cancelled = false
    const assets: Asset[] = data.filter((entry) => entry.kind === 'import' && entry.preview_url).map((entry) => ({
      id: entry.id, name: entry.name, kind: entry.kind, variant: 0,
      duration: entry.duration ?? 1, url: entry.preview_url,
    }))
    // The engine limits concurrent fetch/decode work and shares buffers with audition.
    void previewEngine.prepare(assets).then(() => {
      if (cancelled) return
      const next: Record<string, { peaks: number[]; duration: number }> = {}
      for (const asset of assets) {
        if (!previewEngine.hasBuffer(asset.id)) continue
        const buffer = previewEngine.buffer(asset)
        next[asset.id] = { peaks: waveform(buffer, 0, buffer.duration, 160), duration: buffer.duration }
      }
      setWaveforms(next)
    }).catch(() => { /* Keep metadata and audition available if preview loading fails. */ })
    return () => { cancelled = true }
  }, [data, kind])

  async function preview(entry: LibraryEntry) {
    if (active === entry.id) {
      stop()
      return
    }
    stop()
    const request = generation.current
    setActive(entry.id)
    setLoading(true)
    setPreviewError('')
    const asset: Asset = {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      variant: 0,
      duration: entry.duration ?? 1,
      sound: entry.sound,
      drumKit: entry.drum_kit,
      url: entry.preview_url,
    }
    try {
      if (entry.preview_url) {
        const playback = await previewEngine.auditionAudio(asset)
        if (request !== generation.current || !playback) return
        const updateProgress = () => {
          if (request !== generation.current) return
          const elapsed = previewEngine.getContext().currentTime - playback.startedAt
          if (elapsed >= playback.duration) { stop(); return }
          setProgress(Math.max(0, Math.min(1, elapsed / playback.sourceDuration)))
          animation.current = requestAnimationFrame(updateProgress)
        }
        animation.current = requestAnimationFrame(updateProgress)
      } else {
        await previewEngine.audition(asset, {
          id: 'preview',
          pitch: entry.kind === 'drums' ? 36 : entry.kind === 'bass' ? 36 : 60,
          start: 0,
          duration: 0.8,
          velocity: 0.7,
        })
      }
      if (request !== generation.current) return
      setLoading(false)
      timer.current = setTimeout(stop, entry.preview_url ? Math.min(3, asset.duration) * 1000 : 1500)
    } catch (e) {
      if (request !== generation.current) return
      stop()
      setPreviewError(e instanceof Error ? e.message : 'Could not play preview.')
    }
  }

  const entries = (data ?? []).filter((entry) =>
    kind === 'audio' ? entry.kind === 'import' : entry.kind !== 'import' || entry.category === '采样乐器',
  )
  const categories = [...new Set(entries.map((entry) => entry.category))]
  const filtered = entries.filter((entry) =>
    (category === 'all' || entry.category === category) &&
    `${entry.name} ${entry.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <AppShell breadcrumb={
      <BreadcrumbList><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList>
    }>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="size-5" />
          <h1 className="text-lg font-semibold">{title}</h1>
          {data && <span className="text-sm text-muted-foreground">{entries.length}</span>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input className="w-52 max-w-full" aria-label="Search library" placeholder="Search" value={search}
            onChange={(event) => { stop(); setSearch(event.target.value) }} />
          <select className={selectClass} aria-label="Category" value={category}
            onChange={(event) => { stop(); setCategory(event.target.value) }}>
            <option value="all">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>
      {isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>}
      {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
        {error.message}<Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
      </div>}
      {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
      <div className="grid gap-x-6 @xl:grid-cols-2 @4xl:grid-cols-3">
        {filtered.map((entry) => (
          <div key={entry.id} className="flex min-w-0 items-center gap-3 border-b py-3">
            <Button size="icon" variant={active === entry.id ? 'secondary' : 'ghost'}
              aria-label={active === entry.id ? `Stop ${entry.name}` : `Preview ${entry.name}`}
              aria-pressed={active === entry.id} onClick={() => void preview(entry)}>
              {active === entry.id && loading ? <Loader2 className="animate-spin" /> : active === entry.id ? <Square /> : <Play />}
            </Button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium wrap-break-word">{entry.name}</div>
              {kind === 'audio' && entry.preview_url && (
                <svg className="my-1 h-7 w-full text-waveform/75"
                  viewBox="0 0 160 32" preserveAspectRatio="none" role="img"
                  aria-label={`${entry.name} waveform${waveforms[entry.id] ? '' : ' unavailable'}`}>
                  {waveforms[entry.id] && <>
                    <defs><clipPath id={`${waveformId}-${entry.id}`}>
                      <rect width={active === entry.id ? progress * 160 : 0} height={32} />
                    </clipPath></defs>
                    <path
                      d={waveforms[entry.id].peaks.map((peak, index) => `M${index + .5},${16 - peak * 15}v${peak * 30}`).join('')}
                      stroke="currentColor" strokeWidth=".75" />
                    <path className="text-primary" clipPath={`url(#${waveformId}-${entry.id})`}
                      d={waveforms[entry.id].peaks.map((peak, index) => `M${index + .5},${16 - peak * 15}v${peak * 30}`).join('')}
                      stroke="currentColor" strokeWidth=".75" />
                  </>}
                </svg>
              )}
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span>{entry.category}</span>
                {entry.duration != null && <span>{(waveforms[entry.id]?.duration ?? entry.duration).toFixed(1)} s</span>}
                {entry.source && <span>{entry.source.license}</span>}
              </div>
              {entry.source && <div className="text-xs text-muted-foreground wrap-break-word">{entry.source.credit}</div>}
            </div>
          </div>
        ))}
      </div>
      {data && !filtered.length && <p className="text-sm text-muted-foreground">No matching sounds.</p>}
    </AppShell>
  )
}
