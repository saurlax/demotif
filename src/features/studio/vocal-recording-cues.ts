import type { Source, Clip } from '@/types/project'
import type { z } from 'zod'
import type { recordingCueSchema } from '@/shared/schema'
import { tokenizeVocalLyrics } from '@/lib/vocal-lyrics'

export type RecordingCue = z.infer<typeof recordingCueSchema>
export function recordingBarSeconds(tempo: number, meter: string) {
  const [n, d] = meter.split('/').map(Number)
  return n * 4 / d * 60 / tempo
}
export function recordingOrigin(clip?: Clip) {
  return clip ? clip.start_beat - clip.offset : 0
}
export function recordingPlacement(originBeats: number, durationSeconds: number, tempo: number) {
  const offset = Math.max(0, -originBeats * 60 / tempo)
  return { start_beat: Math.max(0, originBeats), offset, source_duration: Math.max(0, durationSeconds - offset),
    length_beats: Math.max(0, durationSeconds - offset) * tempo / 60 }
}
export function vocalRecordingCues(source: Source, tempo: number): RecordingCue[] {
  const cues: RecordingCue[] = [], notes = [...source.notes].sort((a, b) => a.start - b.start), bs = 60 / tempo
  for (const note of notes) {
    const a = source.vocal?.syllables[note.id]
    if (a?.kind === 'continue') {
      const last = cues.at(-1)
      if (last && Math.abs(last.end - note.start * bs) < 1e-6) last.end = (note.start + note.duration) * bs
      continue
    }
    if (!a?.lyric.trim()) continue
    const tokens = tokenizeVocalLyrics(a.lyric, source.vocal!.language)
    // A single explicitly timed phone per lyric token is the only unambiguous
    // multi-token mapping available in the current score protocol.
    const authored = a.phonemes?.length === tokens.length && a.phonemes.every((p) => p.duration_beats != null)
      && Math.abs(a.phonemes.reduce((sum, p) => sum + p.duration_beats!, 0) - note.duration) < 1e-6
    let cursor = note.start
    tokens.forEach((text, i) => {
      const duration = authored ? a.phonemes![i].duration_beats! : note.duration / tokens.length
      cues.push({ note_id: note.id, text, start: cursor * bs, end: (cursor + duration) * bs,
        timing: tokens.length === 1 ? 'score' : authored ? 'authored' : 'estimated' })
      cursor += duration
    })
  }
  return cues
}
