import { createHash } from 'node:crypto'
import type { Source } from '@/types/project'
import type { InstalledProfile } from './profiles'
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]))
  return value
}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export const scoreHash = (source: Source, tempo: number) => hash({ notes: source.notes, vocal: source.vocal, tempo })
export const profileHash = (profile: InstalledProfile) => hash({
  revision: profile.reference_revision, artifacts: profile.artifacts.map((a) => a.sha256).sort(),
  experiment: profile.experiment, language: profile.language, cpu_threads: profile.cpu_threads, speaker: profile.speaker, device: 'native-pytorch', speedup: profile.sampling_speedup,
})
export function phraseSources(source: Source): Source[] {
  const groups: Source['notes'][] = []
  for (const note of [...source.notes].sort((a, b) => a.start - b.start)) {
    const group = groups.at(-1), previous = group?.at(-1)
    if (previous && Math.abs(note.start - previous.start - previous.duration) <= 1e-6) group!.push(note)
    else groups.push([note])
  }
  return groups.map((notes) => {
    const ids = new Set(notes.map((n) => n.id)), start = notes[0].start, end = notes.at(-1)!.start + notes.at(-1)!.duration
    const vocal = source.vocal!
    return { ...source, notes, vocal: { ...vocal,
      syllables: Object.fromEntries(Object.entries(vocal.syllables).filter(([id]) => ids.has(id))),
      vibrato: Object.fromEntries(Object.entries(vocal.vibrato).filter(([id]) => ids.has(id))),
      pitch: vocal.pitch.filter((p) => p.beat >= start && p.beat <= end),
      volume: vocal.volume,
    } }
  })
}
