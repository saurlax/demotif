import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceSchema } from '@/shared/schema'
import { Store } from '../db'
import { config } from '../config'
import { applyCommands, createProject, getProject, copyProject, saveDraft, type AssetRow } from '../projects'
import { assetResponse } from '../media'
import { VocalJobs } from './jobs'
import { requireVoice } from './profiles'

async function readPublishedWav(db: Store, id: string) {
  const asset = db.get<AssetRow>('SELECT * FROM assets WHERE id=?', id)!
  const response = await assetResponse(new Request('http://localhost/vocal.wav'), asset)
  return Buffer.from(await response.arrayBuffer())
}

it.skipIf(!process.env.DEMOTIF_TEST_NATIVE_SINGING)('renders real native PyTorch through the Node queue, reuses it and survives Save as', async () => {
  const media = config.media, directory = mkdtempSync(join(tmpdir(), 'demotif-native-'))
  config.media = directory
  const db = new Store(':memory:'), queue = new VocalJobs(db)
  try {
    const p = createProject(db, 'Native singing validation'), draft = copyProject(db, p.id, true)
    const source = sourceSchema.parse({ id: 'singer', kind: 'vocal', duration: 8,
      notes: [60, 64, 67, 65].map((pitch, i) => ({ id: `n${i}`, pitch, start: i, duration: 1 })),
      vocal: { voice_id: requireVoice('opencpop-native-demo', 'zh').id, language: 'zh',
        syllables: Object.fromEntries(['你', '好', '音', '乐'].map((lyric, i) => [`n${i}`, { kind: 'syllable', lyric, ...(i === 3 ? { pronunciation: 'yue' } : {}) }])) } })
    applyCommands(db, draft.id, { expected_version: 1, commands: [{ type: 'source.add', source }] })
    const version = getProject(db, draft.id).version
    const first = queue.ensure(draft.id, { expected_version: version, source_id: source.id })
    await queue.idle()
    const status = queue.status(draft.id, first.id)
    expect(status.error).toBeUndefined(); expect(status).toMatchObject({ current: true, status: 'ready' })
    expect(getProject(db, draft.id).version).toBe(version)
    const cached = queue.ensure(draft.id, { expected_version: version, source_id: source.id })
    expect(cached.phrases).toEqual(status.phrases)
    const originalWav = await readPublishedWav(db, status.phrases[0].asset_id)
    writeFileSync(join(tmpdir(), 'demotif-vocal-integrated.wav'), originalWav)
    const pcm = (bytes: Buffer) => {
      for (let pos = 12; pos + 8 <= bytes.length;) {
        const length = bytes.readUInt32LE(pos + 4)
        if (bytes.toString('ascii', pos, pos + 4) === 'data') return Array.from({ length: length / 4 }, (_, i) => bytes.readFloatLE(pos + 8 + i * 4))
        pos += 8 + length + length % 2
      }
      throw new Error('No PCM')
    }
    const original = pcm(originalWav)
    applyCommands(db, draft.id, { expected_version: version, commands: [{ type: 'source.update', source_id: source.id,
      vocal: { ...source.vocal!, pitch: [{ beat: 0, value: 100 }], volume: [{ beat: 0, value: 0.25 }],
        vibrato: { n1: { rate_hz: 5, depth_cents: 40, onset: 0 } } } }] })
    const changedVersion = getProject(db, draft.id).version
    const edited = queue.ensure(draft.id, { expected_version: changedVersion, source_id: source.id })
    await queue.idle()
    const editedResult = queue.status(draft.id, edited.id)
    expect(editedResult).toMatchObject({ status: 'ready', current: true })
    const changedWav = await readPublishedWav(db, editedResult.phrases[0].asset_id)
    const changed = pcm(changedWav)
    const peak = (samples: number[]) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
    expect(peak(changed)).toBeLessThan(peak(original) * 0.6)
    expect(changed).not.toEqual(original)
    writeFileSync(join(tmpdir(), 'demotif-vocal-expression.wav'), changedWav)
    const saved = saveDraft(db, draft.id, { expected_version: changedVersion, save_as: true, name: 'Singing demo' })
    const reopened = copyProject(db, saved.saved_project_id, true)
    const resolved = queue.current(reopened.id, source.id)
    expect(resolved).toMatchObject({ current: true, status: 'ready' })
    expect(resolved.phrases[0].asset_id).not.toBe(status.phrases[0].asset_id)
  } finally { queue.close(); await queue.idle(); db.db.close(); config.media = media; rmSync(directory, { recursive: true, force: true }) }
}, 120000)

it.skipIf(!process.env.DEMOTIF_TEST_NATIVE_SINGING)('renders multiple Chinese syllables on one unchanged native note', async () => {
  const previousMedia = config.media, directory = mkdtempSync(join(tmpdir(), 'demotif-multi-note-'))
  config.media = directory
  const db = new Store(':memory:'), queue = new VocalJobs(db)
  try {
    const project = createProject(db, 'One note, four syllables')
    const source = sourceSchema.parse({ id: 'multiple', kind: 'vocal', duration: 6,
      notes: [{ id: 'one-note', pitch: 64, start: 0, duration: 4 }],
      vocal: { voice_id: 'opencpop-native-demo', language: 'zh', syllables: {
        'one-note': { kind: 'syllable', lyric: '我的妈啊', pronunciation: 'wo de ma a' },
      } } })
    applyCommands(db, project.id, { expected_version: 1, commands: [{ type: 'source.add', source }] })
    const request = queue.ensure(project.id, { expected_version: 2, source_id: source.id })
    await queue.idle()
    const result = queue.status(project.id, request.id)
    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({ status: 'ready', current: true })
    expect(getProject(db, project.id).version).toBe(2)
    expect(JSON.parse(getProject(db, project.id).document).sources[0].notes).toHaveLength(1)
    writeFileSync(join(tmpdir(), 'demotif-one-note-multiple.wav'), await readPublishedWav(db, result.phrases[0].asset_id))
  } finally { queue.close(); await queue.idle(); db.db.close(); config.media = previousMedia; rmSync(directory, { recursive: true, force: true }) }
}, 120000)
