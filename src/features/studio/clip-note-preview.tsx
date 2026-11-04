import type { Note } from '@/types/project'

export function visibleNoteSegments(notes: Note[], offset: number, duration: number) {
  return notes.flatMap((note) => {
    const start = Math.max(offset, note.start)
    const end = Math.min(offset + duration, note.start + note.duration)
    return end > start
      ? [{ id: note.id, pitch: note.pitch, start: start - offset, duration: end - start }]
      : []
  })
}

export function ClipNotePreview({ notes, offset, duration }: {
  notes: Note[]
  offset: number
  duration: number
}) {
  const visible = visibleNoteSegments(notes, offset, duration)
  const low = Math.min(...visible.map((note) => note.pitch))
  const high = Math.max(...visible.map((note) => note.pitch))
  return (
    <svg className="h-full w-full" viewBox={`0 0 ${duration} 26`} preserveAspectRatio="none" aria-hidden="true">
      {visible.map((note) => {
        const y = high === low ? 13 : 4 + ((high - note.pitch) / (high - low)) * 18
        return <path key={note.id} d={`M${note.start} ${y}h${note.duration}`}
          stroke="currentColor" strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      })}
    </svg>
  )
}
