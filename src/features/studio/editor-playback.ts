import type { Clip, Source } from '@/types/project'

export function editorPlaybackClip(source: Source, tempo: number, clip?: Clip): Clip {
  // Musical editors show the whole source, even when opened from a trimmed placement.
  // Audio editors retain their selected source window and instance envelope.
  if (source.kind === 'audio' && clip) return clip
  return {
    id: clip?.id ?? 'preview',
    name: source.name,
    kind: source.kind === 'audio' ? 'audio' : 'midi',
    source_id: source.id,
    asset_id: null,
    start_beat: clip?.start_beat ?? 0,
    length_beats: source.kind === 'audio' ? source.duration * tempo / 60 : source.duration,
    offset: 0,
    source_duration: source.duration,
    gain: 1,
    fade_in: 0,
    fade_out: 0,
    envelope_offset: 0,
    envelope_duration: null,
    locked: false,
    color: null,
  }
}
