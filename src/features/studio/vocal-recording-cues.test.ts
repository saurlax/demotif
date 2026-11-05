import { expect, it } from 'vitest'
import { sourceSchema, referenceRecordingSchema } from '@/shared/schema'
import { recordingBarSeconds, recordingPlacement, vocalRecordingCues } from './vocal-recording-cues'
it('keeps grouped syllables estimated, extending only the final continuation without changing notes', () => {
  const s = sourceSchema.parse({ kind: 'vocal', duration: 8, notes: [
    { id: 'a', start: .125, duration: 2, pitch: 60 }, { id: 'b', start: 2.125, duration: 1, pitch: 60 }],
    vocal: { voice_id: 'v', language: 'zh', syllables: { a: { kind: 'syllable', lyric: '你好' }, b: { kind: 'continue' } } } })
  const before = JSON.stringify(s)
  expect(vocalRecordingCues(s, 120)).toEqual([
    { note_id: 'a', text: '你', start: .0625, end: .5625, timing: 'estimated' },
    { note_id: 'a', text: '好', start: .5625, end: 1.5625, timing: 'estimated' }])
  expect(JSON.stringify(s)).toBe(before)
})
it('uses unambiguous authored budgets and leaves rests blank', () => {
  const s = sourceSchema.parse({ kind: 'vocal', notes: [{ id: 'a', start: 2, duration: 2, pitch: 60 }],
    vocal: { voice_id: 'v', language: 'zh', syllables: { a: { kind: 'syllable', lyric: '你好', phonemes: [
      { symbol: 'ni', duration_beats: .5 }, { symbol: 'hao', duration_beats: 1.5 }] } } } })
  expect(vocalRecordingCues(s, 60).map((c) => [c.start, c.end, c.timing])).toEqual([[2, 2.5, 'authored'], [2.5, 4, 'authored']])
  expect(vocalRecordingCues({ ...s, vocal: { ...s.vocal!, syllables: {} } }, 60)).toEqual([])
  expect(recordingBarSeconds(120, '6/8')).toBe(1.5)
  expect(recordingPlacement(-2, 4, 120)).toEqual({ start_beat: 0, offset: 1, source_duration: 3, length_beats: 6 })
})
it('validates reference timing and keeps legacy sources valid', () => {
  expect(sourceSchema.parse({}).reference_recording).toBeUndefined()
  expect(referenceRecordingSchema.safeParse({ source_id: 's', project_id: 'p', project_version: 1, tempo: 120,
    time_signature: '4/4', source_origin_beat: -2, sample_rate: 48000, capture_start_frame: 100, interrupted: false,
    cues: [{ note_id: 'n', text: 'a', start: 2, end: 1, timing: 'score' }] }).success).toBe(false)
})
