import { afterEach, beforeEach, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../config'
import { sourceSchema } from '@/shared/schema'
import { Store } from '../db'
import { applyCommands, createProject, getProject, copyProject } from '../projects'
import { encodeWavBytes } from '@/audio/pcm'
import { VocalJobs } from './jobs'
import type { InstalledProfile } from './profiles'
import type { NativeWorker } from './worker'
let db: Store, queue: VocalJobs, id: string, calls: number
let media: string, originalMedia: string
let worker: NativeWorker
let release: (() => void) | undefined
const profile = { id: 'demo', language: 'zh', path: '/demo/profile.json', artifacts: [{ path: '/demo/model', sha256: 'abc' }], reference_revision: 'test', sampling_speedup: 10, speaker: 'demo' } as InstalledProfile
const source = sourceSchema.parse({ id: 's', kind: 'vocal', duration: 4,
  notes: [{ id: 'a', pitch: 60, start: 0, duration: 1 }], vocal: { voice_id: 'demo', language: 'zh', syllables: { a: { kind: 'syllable', lyric: '你' } } } })
const edit = (commands: unknown[]) => applyCommands(db, id, { expected_version: getProject(db, id).version, commands })
const start = () => queue.ensure(id, { expected_version: getProject(db, id).version, source_id: 's' })
beforeEach(() => {
  originalMedia = config.media; media = mkdtempSync(join(tmpdir(), 'demotif-vocals-')); config.media = media
  db = new Store(':memory:'); calls = 0; release = undefined; id = createProject(db, 'Demo').id
  edit([{ type: 'source.add', source }])
  worker = {
    async run(input: Record<string, unknown>, signal?: AbortSignal) {
      calls++
      await new Promise<void>((resolve, reject) => {
        release = resolve
        signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
      })
      writeFileSync(String(input.output_path), encodeWavBytes([new Float32Array(4410)], 44100))
      return { path: input.output_path, sample_rate: 44100, samples: 4410, duration_seconds: 0.1,
        alignment: { offset_seconds: -0.15, lead_seconds: 0.15, tail_seconds: 0.2, source_start_beat: 0 } }
    }, stop() {},
  } as unknown as NativeWorker
  queue = new VocalJobs(db, worker, () => profile)
})
afterEach(async () => { queue.close(); release?.(); await queue.idle(); db.db.close(); config.media = originalMedia; rmSync(media, {recursive: true, force: true}) })
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
it('deduplicates phrase work, publishes owned assets, preserves score versions and rejects stale versions', async () => {
  const a = start(), b = start(); const version = getProject(db, id).version
  await tick(); expect(calls).toBe(1); release!(); await queue.idle()
  expect(queue.status(id, a.id).status).toBe('ready'); expect(queue.status(id, b.id).status).toBe('ready')
  expect(getProject(db, id).version).toBe(version)
  expect(db.all('SELECT * FROM assets WHERE project_id=?', id)).toHaveLength(1)
  start(); await queue.idle(); expect(calls).toBe(1)
  expect(() => queue.ensure(id, { source_id: 's', expected_version: 1 })).toThrow()
})
it('keeps late output stale and can reuse it after undo-like score restoration', async () => {
  const a = start(); await tick()
  edit([{ type: 'source.update', source_id: 's', vocal: { ...source.vocal, syllables: { a: { kind: 'syllable', lyric: '好' } } } }])
  release!(); await queue.idle()
  expect(queue.status(id, a.id)).toMatchObject({ status: 'ready', current: false })
  expect(db.all('SELECT * FROM vocal_renders')).toHaveLength(0)
  edit([{ type: 'source.update', source_id: 's', vocal: source.vocal }])
  expect(queue.status(id, a.id).current).toBe(true)
})
it('cancels only unsubscribed work and preserves a shared active request', async () => {
  const a = start(), b = start(); await tick()
  expect(queue.cancel(id, a.id).status).toBe('cancelled')
  release!(); await queue.idle(); expect(queue.status(id, b.id).status).toBe('ready')
  edit([{ type: 'source.update', source_id: 's', name: 'Renamed only' }])
  expect(queue.status(id, b.id).current).toBe(true)
})
it('cancels an unshared running job without publishing partial audio', async () => {
  const a = start(); await tick(); queue.cancel(id, a.id); await queue.idle()
  expect(queue.status(id, a.id).status).toBe('cancelled')
  expect(db.all('SELECT * FROM assets')).toHaveLength(0)
})

it('copies matching rendered assets into independent draft ownership without recomputing', async () => {
  const request = start(); await tick(); release!(); await queue.idle()
  const original = queue.status(id, request.id)
  const draft = copyProject(db, id, true)
  const copied = queue.current(draft.id, 's')
  expect(copied).toMatchObject({status: 'ready', current: true})
  expect(copied.phrases[0].asset_id).not.toBe(original.phrases[0].asset_id)
  expect(db.get('SELECT * FROM assets WHERE id=? AND project_id=?', copied.phrases[0].asset_id, draft.id)).toBeTruthy()
  expect(calls).toBe(1)
})

it('recovers an interrupted persisted job and rejects lookup from another project', async () => {
  const request = start(); await tick(); release!(); await queue.idle()
  queue.close(); await queue.idle()
  db.run("UPDATE vocal_jobs SET status='running',result=NULL")
  queue = new VocalJobs(db, worker, () => profile)
  expect(queue.status(id, request.id).status).toBe('interrupted')
  const other = createProject(db, 'Other').id
  expect(() => queue.status(other, request.id)).toThrow()
  const retried = start(); await tick(); release!(); await queue.idle()
  expect(queue.status(id, retried.id).status).toBe('ready')
})

it('cancels queued jobs without starting inference and rejects malformed or partial files', async () => {
  const a = start()
  queue.cancel(id, a.id)
  await queue.idle(); expect(calls).toBe(0)
  worker.run = (async (input: Record<string, unknown>) => {
    writeFileSync(String(input.output_path), 'RIFFpartial')
    return { path: input.output_path, samples: 1, sample_rate: 44100, duration_seconds: 1 / 44100,
      alignment: { offset_seconds: 0, lead_seconds: 0, tail_seconds: 0, source_start_beat: 0 } }
  }) as NativeWorker['run']
  const b = start(); await queue.idle()
  expect(queue.status(id, b.id)).toMatchObject({ status: 'failed', phrases: [] })
  expect(db.all('SELECT * FROM assets')).toHaveLength(0)
})

it('detects a missing derivative and regenerates it without advancing the score', async () => {
  const a = start(); await tick(); release!(); await queue.idle()
  const result = queue.status(id, a.id)
  const asset = db.get<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id=?', result.phrases[0].asset_id)!
  rmSync(join(media, asset.storage_key))
  expect(queue.current(id, 's').status).toBe('missing')
  const version = getProject(db, id).version
  const b = start(); await tick(); release!(); await queue.idle()
  expect(queue.status(id, b.id)).toMatchObject({ current: true, status: 'ready' })
  expect(calls).toBe(2); expect(getProject(db, id).version).toBe(version)
})
