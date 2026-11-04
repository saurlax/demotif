import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioEngine, waveform } from '@/audio/audio'
import { renderSource } from '@/audio/adapter'
import type { Project, Clip, Track } from '@/types/project'
import { ClipNotePreview } from './clip-note-preview'

export function trackAccent(track: Track, project: Project, index: number) {
  if (track.color) return track.color
  const source = project.document.sources.find((s) => track.clips.some((c) => c.source_id === s.id))
  if (source?.kind === 'drums') return 'var(--track-drums)'
  if (source?.kind === 'audio') return 'var(--track-audio)'
  if (['sub', 'reese', 'electric-bass', 'acid-bass', 'fm-bass', 'organ-bass'].includes(source?.sound ?? '')) return 'var(--track-bass)'
  return ['var(--track-notes)', 'var(--track-melody)', 'var(--track-harmony)', 'var(--track-layer)'][index % 4]
}

export type PreviewClip = Pick<Clip, 'name' | 'source_id' | 'offset' | 'source_duration' | 'length_beats'>

export function clipPreviewColor(project: Project, sourceId: string | null, track?: Track, color?: string | null) {
  if (color) return color
  const owner = track ?? project.document.tracks.find((t) => t.clips.some((clip) => clip.source_id === sourceId))
  if (owner) {
    const placed = owner.clips.find((clip) => clip.source_id === sourceId)
    return (!track && placed?.color) || trackAccent(owner, project, project.document.tracks.indexOf(owner))
  }
  const source = project.document.sources.find((s) => s.id === sourceId)
  if (source?.kind === 'drums') return 'var(--track-drums)'
  if (source?.kind === 'audio') return 'var(--track-audio)'
  return 'var(--waveform)'
}

export function ClipPreviewContents({ project, clip, engine, trailing }: {
  project: Project
  clip: PreviewClip
  engine: AudioEngine
  trailing?: ReactNode
}) {
  const source = project.document.sources.find((s) => s.id === clip.source_id)
  return <>
    <div className="flex items-center justify-between gap-3 border-b px-2 py-1 text-sm font-medium">
      <span className="truncate">{clip.name}</span>
      {trailing && <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>}
    </div>
    <div className="h-8 px-2 py-1 text-foreground/75">
      {source?.kind === 'audio'
        ? <AudioPreview project={project} clip={clip} engine={engine} />
        : source && <ClipNotePreview notes={source.notes} offset={clip.offset}
          duration={clip.source_duration ?? clip.length_beats} />}
    </div>
  </>
}

export function AudioPreview({
  project,
  clip,
  engine,
}: {
  project: Project
  clip: Pick<Clip, 'source_id' | 'offset' | 'source_duration'>
  engine: AudioEngine
}) {
  const [peaks, setPeaks] = useState<number[]>([])
  const svg = useRef<SVGSVGElement>(null)
  const [bars, setBars] = useState(120)
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const measure = () => setBars(Math.max(32, Math.min(8192, Math.ceil(element.clientWidth / 2))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const source = project.document.sources.find((s) => s.id === clip.source_id)
  useEffect(() => {
    let active = true
    if (!source) return
    const asset = renderSource(source, project.id, project.document.tempo)
    void engine
      .prepare([asset])
      .then(() => {
        if (active)
          setPeaks(
            waveform(
              engine.buffer(asset),
              clip.offset,
              clip.source_duration ?? source.duration - clip.offset,
              bars,
            ),
          )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [
    engine,
    bars,
    source,
    project.id,
    project.document.tempo,
    clip.offset,
    clip.source_duration,
  ])
  return (
    <svg
      ref={svg}
      className="h-6 w-full"
      viewBox={`0 0 ${bars} 50`}
      preserveAspectRatio="none"
      aria-label="Audio waveform"
    >
      <path
        d={peaks.map((p, i) => `M${i},${25 - p * 24}v${p * 48}`).join('')}
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
