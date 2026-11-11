import { validateVocalWav } from './wav'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { documentSchema, newId } from '@/shared/schema'
import type { Source } from '@/types/project'
import type { VocalPhraseResult, VocalRenderStatus } from '@/types/vocal'
import type { Store } from '../db'
import { config, repositoryRoot } from '../config'
import { conflict, invalid, missing } from '../errors'
import { getProject, now } from '../projects'
import { safePath, prepareAsset, publishAsset } from '../media'
import { voiceCatalog, requireVoice, type InstalledProfile } from './profiles'
import { hash, phraseSources, profileHash, scoreHash } from './fingerprint'
import type { NativeWorker } from './worker'
import { renderModalVocal, type ModalVoiceTarget } from './modal'
type Row = { id: string; project_id: string; source_id: string; fingerprint: string; score_hash: string; job_ids: string; cancelled: boolean }
type Job = { id: string; project_id: string; fingerprint: string; snapshot: string; status: VocalRenderStatus['status']; stage: string | null; result: string | null; error: string | null }
const requestSchema = z.object({ source_id: z.string(), expected_version: z.number().int(), quality: z.enum(['preview', 'final']).default('final') })
const resultSchema = z.object({ sample_rate: z.number().positive(), samples: z.number().positive(), duration_seconds: z.number().positive(),
  alignment: z.object({ offset_seconds: z.number(), lead_seconds: z.number(), tail_seconds: z.number(), source_start_beat: z.number() }) })
const localResultSchema = resultSchema.extend({ path: z.string() })
const modalResultSchema = z.strictObject({ audio_wav: z.instanceof(Uint8Array), result: resultSchema })
type VocalSnapshot = { source: Source; source_context?: Source; tempo: number; profile_path: string; profile_fingerprint?: string; engine?: string; modal?: ModalVoiceTarget }
export class VocalJobs {
  private pumping?: Promise<void>
  private controllers = new Map<string, AbortController>()
  private db: Store
  private worker?: NativeWorker
  private voice: typeof requireVoice
  private closed = false
  constructor(db: Store, worker?: NativeWorker, voice = requireVoice) {
    this.db = db; this.worker = worker; this.voice = voice
    db.run("UPDATE vocal_jobs SET status='interrupted',error='Inference was interrupted' WHERE status='running'")
    this.dispatch()
  }
  private signature(profile: InstalledProfile) {
    if (profile.modal && profile.engine === 'nnsvs') return hash({ profile: profileHash(profile), modal: profile.modal, device: 'cpu',
      runtime: hash(['modal_ja_app.py', 'nnsvs-requirements.txt', 'nnsvs_native.py', 'japanese_score.py'].map((file) =>
        readFileSync(resolve(repositoryRoot, 'workers/singing', file), 'utf8'))), precision: 'float32', seed: 1234 })
    if (profile.modal) return hash({ profile: profileHash(profile), modal: profile.modal, device: 'cuda',
      runtime: hash(['modal_app.py', 'pyproject.toml', 'native.py', 'score.py'].map((file) =>
        readFileSync(resolve(repositoryRoot, 'workers/singing', file), 'utf8'))), precision: 'float32', seed: 1234 })
    if (profile.engine === 'nnsvs') return hash({ profile: profileHash(profile), device: config.singingDevice,
      runtime: hash(readFileSync(resolve(repositoryRoot, 'workers/singing/nnsvs-requirements.txt'), 'utf8')),
      compiler: hash(['japanese_score.py', 'nnsvs_native.py', 'nnsvs_worker.py'].map((p) => readFileSync(resolve(repositoryRoot, 'workers/singing', p), 'utf8'))), precision: 'float32', seed: 1234 })
    return hash({ profile: profileHash(profile), device: config.singingDevice,
      runtime: hash(readFileSync(resolve(repositoryRoot, 'workers/singing/uv.lock'), 'utf8')), compiler: hash(['score.py', 'native.py', 'worker.py'].map((p) => readFileSync(resolve(repositoryRoot, 'workers/singing', p), 'utf8'))), precision: 'float32', seed: 1234 })
  }
  private source(project: string, sourceId: string) {
    return documentSchema.parse(JSON.parse(getProject(this.db, project).document)).sources.find((s) => s.id === sourceId) ?? missing('Vocal source not found')
  }
  ensure(project: string, input: unknown): VocalRenderStatus {
    const request = requestSchema.parse(input), current = getProject(this.db, project)
    if (request.expected_version !== current.version) conflict(current.version)
    const document = documentSchema.parse(JSON.parse(current.document)), source = document.sources.find((s) => s.id === request.source_id)
    if (!source || source.kind !== 'vocal' || !source.vocal) invalid('Select a vocal source')
    if (!source.notes.length) invalid('Add vocal notes before synthesis')
    for (const n of source.notes) {
      const syllable = source.vocal.syllables[n.id]
      if (!syllable || (syllable.kind === 'syllable' && !syllable.lyric.trim())) invalid(`Add a lyric for the vocal note at beat ${Number((n.start + 1).toFixed(3))} using Lyrics or note settings`)
    }
    const profile = this.voice(source.vocal.voice_id, source.vocal.language)
    const signature = this.signature(profile)
    const key = hash({ score: scoreHash(source, document.tempo), signature, quality: 'full' })
    const context = profile.engine === 'nnsvs' ? { source_context: source, engine: profile.engine } : {}
    const modal = profile.modal ? { ...profile.modal, voiceId: profile.id, ...(profile.engine === 'nnsvs' ? { engine: profile.engine } : {}) } : undefined
    const ids = this.db.tx(() => phraseSources(source, profile.engine === 'nnsvs' ? document.tempo : undefined).map((phrase) => {
      const fingerprint = hash({ score: scoreHash(phrase, document.tempo), signature, quality: 'full',
        ...(profile.engine === 'nnsvs' ? { pronunciation_context: scoreHash(source, document.tempo) } : {}) })
      const id = hash({ project, fingerprint })
      const existing = this.db.get<Job>('SELECT * FROM vocal_jobs WHERE id=?', id)
      if (existing?.status === 'ready' && !this.hasAudio(existing))
        this.db.run("UPDATE vocal_jobs SET status='missing',result=NULL WHERE id=?", id)
      this.db.run("INSERT OR IGNORE INTO vocal_jobs (id,project_id,fingerprint,snapshot,status,created_at) VALUES (?,?,?,?,'queued',?)",
        id, project, fingerprint, JSON.stringify({ source: phrase, tempo: document.tempo, profile_path: profile.path, profile_fingerprint: signature, ...context, modal }), now())
      this.db.run("UPDATE vocal_jobs SET status='queued',error=NULL WHERE id=? AND status IN ('failed','interrupted','cancelled','missing')", id)
      return id
    }))
    const id = newId()
    this.db.run('INSERT INTO vocal_requests (id,project_id,source_id,fingerprint,score_hash,job_ids,created_at) VALUES (?,?,?,?,?,?,?)',
      id, project, source.id, key, scoreHash(source, document.tempo), JSON.stringify(ids), now())
    this.dispatch()
    return this.status(project, id)
  }
  private requireRequest(project: string, id: string) {
    return this.db.get<Row>('SELECT * FROM vocal_requests WHERE id=? AND project_id=?', id, project) ?? missing('Vocal render not found')
  }
  private hasAudio(job: Job) {
    if (!job.result) return false
    const result = JSON.parse(job.result) as VocalPhraseResult
    const asset = this.db.get<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id=? AND project_id=?', result.asset_id, job.project_id)
    return !!asset && (asset.storage_key.startsWith('s3:') || existsSync(safePath(config.media, asset.storage_key)))
  }
  status(project: string, id: string): VocalRenderStatus {
    const row = this.requireRequest(project, id)
    const jobs = (JSON.parse(row.job_ids) as string[]).map((key) => this.db.get<Job>('SELECT * FROM vocal_jobs WHERE id=?', key)!)
    const document = documentSchema.parse(JSON.parse(getProject(this.db, project).document))
    const source = document.sources.find((s) => s.id === row.source_id)
    let current = !!source && row.score_hash === scoreHash(source, document.tempo)
    if (current && source?.vocal) {
      try {
        const profile = this.voice(source.vocal.voice_id, source.vocal.language)
        current = row.fingerprint === hash({ score: scoreHash(source, document.tempo), signature: this.signature(profile), quality: 'full' })
      } catch { /* Matching saved audio stays usable when its model is uninstalled. */ }
    }
    for (const job of jobs) if (job.status === 'ready' && !this.hasAudio(job)) job.status = 'missing'
    let state: VocalRenderStatus['status'] = row.cancelled ? 'cancelled' : 'ready'
    if (!row.cancelled) {
      const incomplete = jobs.find((j) => ['failed', 'interrupted', 'cancelled'].includes(j.status)) ?? jobs.find((j) => j.status === 'running') ?? jobs.find((j) => j.status !== 'ready')
      state = incomplete?.status ?? 'ready'
    }
    if (current && state === 'ready') this.db.run('INSERT OR REPLACE INTO vocal_renders (project_id,source_id,fingerprint,request_id) VALUES (?,?,?,?)', project, row.source_id, row.fingerprint, row.id)
    return { id, source_id: row.source_id, fingerprint: row.fingerprint, current, status: state,
      stage: jobs.find((j) => j.status === 'running')?.stage ?? undefined,
      error: jobs.find((j) => j.error)?.error ?? undefined,
      phrases: jobs.filter((j) => j.status === 'ready' && j.result).map((j) => JSON.parse(j.result!) as VocalPhraseResult) }
  }
  current(project: string, sourceId: string): VocalRenderStatus {
    const source = this.source(project, sourceId)
    const rows = this.db.all<Row>('SELECT * FROM vocal_requests WHERE project_id=? AND source_id=? AND cancelled=0 ORDER BY created_at DESC,rowid DESC', project, sourceId)
    const statuses = rows.map((row) => this.status(project, row.id))
    const matching = statuses.find((s) => s.current && s.status === 'ready') ?? statuses.find((s) => s.current)
    if (matching) return matching
    if (statuses[0]) return statuses[0]
    return { id: '', source_id: sourceId, fingerprint: '', current: false, status: 'missing', phrases: [], error: source.vocal ? undefined : 'Select a vocal source' }
  }
  cancel(project: string, id: string) {
    const row = this.requireRequest(project, id)
    this.db.run('UPDATE vocal_requests SET cancelled=1 WHERE id=?', id)
    for (const job of JSON.parse(row.job_ids) as string[]) {
      if (this.active(job)) continue
      this.db.run("UPDATE vocal_jobs SET status='cancelled' WHERE id=? AND status IN ('queued','running')", job)
      this.controllers.get(job)?.abort()
    }
    return this.status(project, id)
  }
  private active(id: string) {
    return !!this.db.get("SELECT 1 FROM vocal_requests r,json_each(r.job_ids) j WHERE r.cancelled=0 AND j.value=? LIMIT 1", id)
  }
  dispatch() {
    if (this.closed) return
    this.pumping ??= Promise.resolve().then(() => this.pump()).finally(() => {
      this.pumping = undefined
      if (!this.closed && this.db.get("SELECT 1 FROM vocal_jobs j WHERE j.status='queued' AND EXISTS (SELECT 1 FROM vocal_requests r,json_each(r.job_ids) member WHERE r.cancelled=0 AND member.value=j.id) LIMIT 1")) this.dispatch()
    })
  }
  async idle() { while (this.pumping) await this.pumping }
  private async pump() {
    for (;;) {
      if (this.closed) return
      const job = this.db.get<Job>("SELECT j.* FROM vocal_jobs j WHERE status='queued' AND EXISTS (SELECT 1 FROM vocal_requests r,json_each(r.job_ids) member WHERE r.cancelled=0 AND member.value=j.id) ORDER BY created_at,rowid LIMIT 1")
      if (!job) return
      const controller = new AbortController(); this.controllers.set(job.id, controller)
      this.db.run("UPDATE vocal_jobs SET status='running',stage='loading' WHERE id=?", job.id)
      let directory: string | undefined
      try {
        const snapshot = JSON.parse(job.snapshot) as VocalSnapshot
        let data: z.infer<typeof resultSchema>, bytes: Buffer
        if (snapshot.modal) {
          const response = modalResultSchema.parse(await renderModalVocal(snapshot.modal, snapshot.source, snapshot.tempo, controller.signal, snapshot.source_context))
          data = response.result
          bytes = Buffer.from(response.audio_wav)
        } else if (this.worker) {
          directory = safePath(config.media, `.vocal-work/${job.id}`)
          mkdirSync(directory, { recursive: true })
          const input = join(directory, 'score.json'), output = join(directory, 'output.wav')
          writeFileSync(input, JSON.stringify(snapshot))
          const local = localResultSchema.parse(await this.worker.run({ action: 'render_source', profile: snapshot.profile_path,
            device: config.singingDevice, engine: snapshot.engine, profile_fingerprint: snapshot.profile_fingerprint, score_path: input, output_path: output, seed: 1234 }, controller.signal,
          (stage) => this.db.run('UPDATE vocal_jobs SET stage=? WHERE id=?', stage, job.id)))
          controller.signal.throwIfAborted()
          if (realpathSync(local.path) !== realpathSync(output)) throw new Error('Unexpected worker output path')
          data = local
          bytes = readFileSync(output)
        } else throw new Error('This render used a retired local voice. Start a new render with the Modal voice.')
        controller.signal.throwIfAborted()
        validateVocalWav(bytes, data)
        const prepared = await prepareAsset(job.project_id, 'Vocal phrase.wav', 'audio/wav', bytes, 'vocal-render', undefined, controller.signal)
        controller.signal.throwIfAborted()
        this.db.tx(() => {
          if (!this.active(job.id)) return
          const asset = publishAsset(this.db, prepared)
          const result = { asset_id: asset.id, sample_rate: data.sample_rate, duration_seconds: data.duration_seconds, alignment: data.alignment }
          this.db.run("UPDATE vocal_jobs SET status='ready',stage='complete',result=?,error=NULL WHERE id=?", JSON.stringify(result), job.id)
          for (const request of this.db.all<Row>('SELECT * FROM vocal_requests WHERE project_id=? AND cancelled=0', job.project_id))
            if ((JSON.parse(request.job_ids) as string[]).includes(job.id)) this.status(job.project_id, request.id)
        })
      } catch (error) {
        if (!controller.signal.aborted) this.db.run('UPDATE vocal_jobs SET status=?,error=? WHERE id=?',
          error instanceof Error && error.name === 'WorkerExited' ? 'interrupted' : 'failed',
          error instanceof Error ? error.message : 'Singing synthesis failed', job.id)
      } finally {
        this.controllers.delete(job.id)
        if (directory) rmSync(directory, { recursive: true, force: true })
      }
    }
  }
  close() { this.closed = true; for (const c of this.controllers.values()) c.abort(); this.worker?.stop() }
}
const globalQueues = globalThis as typeof globalThis & { demotifVocals?: WeakMap<Store, VocalJobs> }
export function vocals(db: Store) {
  const queues = globalQueues.demotifVocals ??= new WeakMap<Store, VocalJobs>()
  let queue = queues.get(db)
  if (!queue) { queue = new VocalJobs(db); queues.set(db, queue) }
  return queue
}
export const voices = () => voiceCatalog()
