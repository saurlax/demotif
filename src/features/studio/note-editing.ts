import type { Source } from '@/types/project'

export const NOTE_GRID = 0.25
export function snapNoteDuration(value: number, limit: number) {
  const maximum = Math.max(Math.min(NOTE_GRID, limit), Math.floor((limit + 1e-8) / NOTE_GRID) * NOTE_GRID)
  return Math.max(Math.min(NOTE_GRID, limit), Math.min(maximum, Math.round(value / NOTE_GRID) * NOTE_GRID))
}
export const formatNoteDuration = (value: number) => `${Number(value.toFixed(2))} beats`

export function removeEditorNote(source: Source, noteId: string): Pick<Source, 'notes' | 'vocal'> {
  const notes = source.notes.filter((n) => n.id !== noteId)
  if (!source.vocal) return { notes }
  const ids = new Set(notes.map((n) => n.id))
  const syllables = Object.fromEntries(Object.entries(source.vocal.syllables).filter(([id]) => ids.has(id)))
  const ordered = [...notes].sort((a, b) => a.start - b.start)
  for (let i = 0; i < ordered.length; i++) {
    if (syllables[ordered[i].id]?.kind !== 'continue') continue
    const previous = ordered[i - 1], parent = previous && syllables[previous.id]
    if (!previous || !parent || (parent.kind === 'syllable' && !parent.lyric.trim()) || Math.abs(previous.start + previous.duration - ordered[i].start) > 1e-6)
      delete syllables[ordered[i].id]
  }
  return { notes, vocal: { ...source.vocal, syllables,
    vibrato: Object.fromEntries(Object.entries(source.vocal.vibrato).filter(([id]) => ids.has(id))),
  } }
}
