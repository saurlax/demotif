import { emptySource } from '@/audio/adapter'
import type { VocalTake } from '@/audio/vocal-recorder'
import type { Source, ProducerCommand } from '@/types/project'
import { recordingPlacement } from './vocal-recording-cues'

export type ReferenceSnapshot = Omit<NonNullable<Source['reference_recording']>, 'sample_rate' | 'capture_start_frame' | 'interrupted'>
export function referenceCommands(take: VocalTake, snapshot: ReferenceSnapshot, assetId: string, name: string): ProducerCommand[] {
  const sourceId = `reference-${take.id}`, trackId = `reference-track-${take.id}`
  const placement = recordingPlacement(snapshot.source_origin_beat, take.duration, snapshot.tempo)
  if (placement.length_beats <= 0) throw new Error('This take ends before the project begins. Download it or record a longer take.')
  const source: Source = { ...emptySource('audio'), id: sourceId, name: `${name.slice(0, 90)} · Reference`,
    asset_id: assetId, duration: take.duration, reference_recording: { ...snapshot,
      sample_rate: take.sampleRate, capture_start_frame: take.startFrame, interrupted: take.interrupted } }
  return [
    { type: 'source.add', source },
    { type: 'part.add', part: { id: `reference-part-${take.id}`, name: source.name, source_id: sourceId, offset: 0, duration: take.duration } },
    { type: 'track.add', id: trackId, name: source.name, kind: 'audio' },
    { type: 'track.update', track_id: trackId, muted: true },
    { type: 'clip.add', id: `reference-clip-${take.id}`, track_id: trackId, name: source.name, kind: 'audio', source_id: sourceId, ...placement },
  ]
}
