import { afterAll, expect, it } from 'vitest'
import { referenceCommands, type ReferenceSnapshot } from '@/features/studio/reference-recording'
import { Store } from './db'
import { applyCommands, copyProject, createProject, getProject, readProject, saveDraft } from './projects'
import type { VocalTake } from '@/audio/vocal-recorder'
const db = new Store(':memory:')
afterAll(() => db.db.close())
it('persists reference audio and cue context atomically, replays safely and preserves it through save-as', () => {
  const base = createProject(db, 'Reference'), draft = copyProject(db, base.id, true)
  db.run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)', 'asset', draft.id, 'reference', 'take.wav', 'audio/wav', 100, 'take.wav', new Date().toISOString())
  const snapshot: ReferenceSnapshot = { project_id: draft.id, source_id: 'vocal', project_version: draft.version,
    tempo: 120, time_signature: '4/4', source_origin_beat: -2, cues: [{ note_id: 'n', text: '你好', start: 0, end: 1, timing: 'score' }] }
  const take = { id: 'take', duration: 4, sampleRate: 48000, startFrame: 100, interrupted: false } as VocalTake
  const commands = referenceCommands(take, snapshot, 'asset', 'Vocal')
  const request = { expected_version: draft.version, request_id: 'save-take', commands }
  applyCommands(db, draft.id, request, true)
  applyCommands(db, draft.id, request, true)
  const current = getProject(db, draft.id), doc = readProject(db, current).document
  expect(doc.sources).toHaveLength(1); expect(doc.tracks).toHaveLength(1)
  expect(doc.tracks[0].muted).toBe(true)
  expect(doc.tracks[0].clips[0]).toMatchObject({ start_beat: 0, offset: 1, length_beats: 6 })
  expect(doc.sources[0].reference_recording).toMatchObject({ ...snapshot, sample_rate: 48000 })
  const saved = saveDraft(db, draft.id, { expected_version: current.version, save_as: true, name: 'Saved reference' })
  expect(copyProject(db, saved.saved_project_id, true).document.sources[0].reference_recording).toEqual(doc.sources[0].reference_recording)
  expect(() => applyCommands(db, draft.id, { expected_version: 1, commands })).toThrow()
})
it('rejects an atomic reference batch with a missing asset without adding sources/tracks', () => {
  const p = createProject(db, 'Missing asset')
  const take = { id: 'bad', duration: 2, sampleRate: 48000, startFrame: 100, interrupted: false } as VocalTake
  const snapshot: ReferenceSnapshot = { project_id: p.id, source_id: 'v', project_version: p.version, tempo: 120,
    time_signature: '4/4', source_origin_beat: 0, cues: [] }
  expect(() => applyCommands(db, p.id, { expected_version: p.version, commands: referenceCommands(take, snapshot, 'missing', 'Voice') })).toThrow()
  expect(readProject(db, getProject(db, p.id)).document.sources).toEqual([])
})
