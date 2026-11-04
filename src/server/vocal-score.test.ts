import { afterEach, beforeEach, expect, it } from 'vitest'
import { sourceSchema } from '@/shared/schema'
import { Store } from './db'
import { applyCommands, copyProject, createProject, getProject, readProject, saveDraft, undo } from './projects'

let db: Store
beforeEach(() => { db = new Store(':memory:') })
afterEach(() => db.db.close())
const score = () => sourceSchema.parse({
  id: 'singer', kind: 'vocal', duration: 4,
  notes: [{ id: 'a', pitch: 60, start: 0, duration: 1 }, { id: 'b', pitch: 62, start: 1, duration: 1 }],
  vocal: { voice_id: 'opencpop-native-demo', language: 'zh',
    syllables: { a: { kind: 'syllable', lyric: '你', pronunciation: 'ni', phonemes: [{ symbol: 'n', duration_beats: 0.2 }, { symbol: 'i' }] }, b: { kind: 'continue' } },
    pitch: [{ beat: 0, value: 0 }, { beat: 1, value: 20 }],
    vibrato: { b: { rate_hz: 5, depth_cents: 25 } },
  },
})
const edit = (id: string, commands: unknown[], version = getProject(db, id).version) =>
  applyCommands(db, id, { expected_version: version, commands })
const read = (id: string) => readProject(db, getProject(db, id))

it('round-trips vocal data without injecting new metadata into legacy sources', () => {
  const source = score()
  expect(sourceSchema.parse(JSON.parse(JSON.stringify(source)))).toEqual(source)
  expect(sourceSchema.parse({ kind: 'notes' })).not.toHaveProperty('vocal')
  expect(sourceSchema.parse({ kind: 'notes', notes: [
    { pitch: 60, start: 0, duration: 2 }, { pitch: 64, start: 0, duration: 2 },
  ] }).notes).toHaveLength(2)
})

it('rejects ambiguous overlaps, orphan continuations and invalid timing/curve references', () => {
  const s = score()
  expect(() => sourceSchema.parse({ ...s, notes: s.notes.map((n) => ({ ...n, start: 0 })) })).toThrow(/overlap/)
  expect(() => sourceSchema.parse({ ...s, notes: [s.notes[1]] })).toThrow()
  expect(() => sourceSchema.parse({ ...s, notes: [s.notes[0], { ...s.notes[1], start: 2 }] })).toThrow(/Continuation/)
  expect(() => sourceSchema.parse({ ...s, vocal: { ...s.vocal, vibrato: { missing: { rate_hz: 5, depth_cents: 10 } } } })).toThrow(/missing note/)
  expect(() => sourceSchema.parse({ ...s, vocal: { ...s.vocal, pitch: [{ beat: 3, value: 0 }, { beat: 2, value: 0 }] } })).toThrow(/ordered/)
  expect(() => sourceSchema.parse({ ...s, vocal: { ...s.vocal, syllables: { a: { kind: 'syllable', lyric: '你', pronunciation: 'ni', phonemes: [{ symbol: 'i', duration_beats: 4 }] } } } })).toThrow(/durations exceed/)
  expect(sourceSchema.parse({ kind: 'vocal', vocal: { voice_id: 'uninstalled', language: 'zh' } }).notes).toEqual([])
})

it('applies atomic vocal edits with versions, shared-source locks and append-only undo', () => {
  const p = createProject(db, 'Vocal')
  edit(p.id, [{ type: 'source.add', source: score() }, { type: 'track.add', id: 't', name: 'Vocal', kind: 'vocal' },
    { type: 'clip.add', track_id: 't', id: 'c', source_id: 'singer', length_beats: 4 }])
  const original = read(p.id)
  const changed = { ...score().vocal!, syllables: { a: { kind: 'syllable' as const, lyric: '好' }, b: { kind: 'continue' as const } } }
  edit(p.id, [{ type: 'source.update', source_id: 'singer', vocal: changed }])
  expect(() => edit(p.id, [{ type: 'source.update', source_id: 'singer', vocal: changed }], original.version)).toThrow()
  undo(db, p.id, getProject(db, p.id).version)
  expect(read(p.id).document.sources[0].vocal).toEqual(original.document.sources[0].vocal)
  edit(p.id, [{ type: 'track.set_lock', track_id: 't', locked: true }])
  expect(() => edit(p.id, [{ type: 'source.update', source_id: 'singer', vocal: changed }])).toThrow()
  expect(db.all('SELECT * FROM operations WHERE project_id=?', p.id).length).toBeGreaterThan(3)
})

it('preserves absent voice profiles, lyrics and curves through draft save, save-as and reopen', () => {
  const p = createProject(db, 'Vocal')
  edit(p.id, [{ type: 'source.add', source: score() }])
  const draft = copyProject(db, p.id, true)
  const changed = { ...score().vocal!, voice_id: 'not-installed-here' }
  edit(draft.id, [{ type: 'source.update', source_id: 'singer', vocal: changed }])
  const saved = saveDraft(db, draft.id, { expected_version: getProject(db, draft.id).version })
  expect(saved.project.has_unsaved_changes).toBe(false)
  expect(read(p.id).document.sources[0].vocal).toEqual(changed)
  const copied = saveDraft(db, draft.id, { expected_version: saved.project.version, save_as: true, name: 'New singer project' })
  expect(read(copied.saved_project_id).document.sources[0].vocal).toEqual(changed)
  const reopened = copyProject(db, copied.saved_project_id, true)
  expect(reopened.document.sources[0].vocal).toEqual(changed)
  expect(reopened.has_unsaved_changes).toBe(false)
})

it('keeps phrase modes and explicit splitting atomic, reversible and saveable under shared locks', async () => {
  const { applyVocalEntry } = await import('@/lib/vocal-lyrics')
  const base = createProject(db, 'Phrase modes'), draft = copyProject(db, base.id, true)
  const source = score()
  edit(draft.id, [{ type: 'source.add', source }])
  const multiple = applyVocalEntry(source, 'a', '你好音乐', { mode: 'multiple', pronunciation: 'ni hao yin yue' })
  edit(draft.id, [{ type: 'source.update', source_id: source.id, ...multiple }])
  expect(read(draft.id).document.sources[0].notes).toEqual(source.notes)
  expect(read(draft.id).document.sources[0].vocal!.syllables.a).toMatchObject({ mode: 'multiple', lyric: '你好音乐' })
  const saved = saveDraft(db, draft.id, { expected_version: getProject(db, draft.id).version, save_as: true, name: 'Phrase modes saved' })
  const reopened = copyProject(db, saved.saved_project_id, true)
  expect(read(reopened.id).document.sources[0].vocal!.syllables.a).toMatchObject({ mode: 'multiple', pronunciation: 'ni hao yin yue' })
  let sequence = 0
  const split = applyVocalEntry(read(draft.id).document.sources[0], 'a', '你好音乐', { mode: 'across', split: true, newId: () => `child-${++sequence}` })
  edit(draft.id, [{ type: 'source.update', source_id: source.id, ...split }])
  expect(read(draft.id).document.sources[0].notes).toHaveLength(5)
  undo(db, draft.id, getProject(db, draft.id).version)
  expect(read(draft.id).document.sources[0].notes).toEqual(source.notes)
  expect(read(draft.id).document.sources[0].vocal!.syllables.a).toMatchObject({ mode: 'multiple' })
  edit(draft.id, [{ type: 'track.add', id: 'locked-vocal', name: 'Vocal' }, { type: 'clip.add', track_id: 'locked-vocal', source_id: source.id, length_beats: 4 }, { type: 'track.set_lock', track_id: 'locked-vocal', locked: true }])
  expect(() => edit(draft.id, [{ type: 'source.update', source_id: source.id, ...split }])).toThrow()
})
