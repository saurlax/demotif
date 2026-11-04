import type { Store } from '../db'
import { newId } from '@/shared/schema'
import { hash } from './fingerprint'
interface Binding { source_id: string; fingerprint: string; request_id: string }
interface Request { score_hash: string; job_ids: string }
interface Job { fingerprint: string; snapshot: string; status: string; result: string | null }
interface Asset { id: string; kind: string; filename: string; content_type: string; size_bytes: number; storage_key: string }
export function cloneVocalRenders(db: Store, from: string, destination: string) {
  const now = new Date().toISOString()
  for (const binding of db.all<Binding>('SELECT * FROM vocal_renders WHERE project_id=?', from)) {
    const request = db.get<Request>('SELECT * FROM vocal_requests WHERE id=? AND project_id=? AND cancelled=0', binding.request_id, from)
    if (!request) continue
    const jobs = (JSON.parse(request.job_ids) as string[]).map((id) => db.get<Job>('SELECT * FROM vocal_jobs WHERE id=? AND project_id=?', id, from))
    if (jobs.some((j) => !j || j.status !== 'ready' || !j.result)) continue
    const cloned: string[] = []
    for (const job of jobs as Job[]) {
      const id = hash({ project: destination, fingerprint: job.fingerprint })
      const existing = db.get<{ result: string }>("SELECT result FROM vocal_jobs WHERE id=? AND status='ready'", id)
      if (!existing) {
        const result = JSON.parse(job.result!) as { asset_id: string }
        const asset = db.get<Asset>('SELECT * FROM assets WHERE id=? AND project_id=?', result.asset_id, from)
        if (!asset) break
        const newAsset = newId()
        db.run('INSERT INTO assets (id,project_id,kind,filename,content_type,size_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)',
          newAsset, destination, asset.kind, asset.filename, asset.content_type, asset.size_bytes, asset.storage_key, now)
        db.run("INSERT OR REPLACE INTO vocal_jobs (id,project_id,fingerprint,snapshot,status,stage,result,created_at) VALUES (?,?,?,?,'ready','complete',?,?)",
          id, destination, job.fingerprint, job.snapshot, JSON.stringify({ ...result, asset_id: newAsset }), now)
      }
      cloned.push(id)
    }
    if (cloned.length !== jobs.length) continue
    const id = newId()
    db.run('INSERT INTO vocal_requests (id,project_id,source_id,fingerprint,score_hash,job_ids,created_at) VALUES (?,?,?,?,?,?,?)',
      id, destination, binding.source_id, binding.fingerprint, request.score_hash, JSON.stringify(cloned), now)
    db.run('INSERT OR REPLACE INTO vocal_renders (project_id,source_id,fingerprint,request_id) VALUES (?,?,?,?)', destination, binding.source_id, binding.fingerprint, id)
  }
}
