import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../src/server/db';
import { config } from '../src/server/config';
import { binaries, sha256 } from '../src/server/storage';
import { safePath, assetRef } from '../src/server/media';
import { publishTree, restoreTree, externalVoiceRoots } from '../src/server/catalogs';
import type { AssetRow } from '../src/server/projects';

const command = process.argv[2];
const dbPath = resolve(process.argv[3] ?? config.database);
async function main() {
  if (command === 'verify') {
    const store = binaries(), bytes = Buffer.from('Demotif private storage verification\n');
    const ref = await store.put(bytes, 'application/octet-stream');
    const response = await store.response(new Request('http://localhost', { headers: { range: 'bytes=0-6' } }), ref);
    if (response.status !== 206 || await response.text() !== 'Demotif') throw new Error('Range verification failed');
    console.log(JSON.stringify({ upload: true, read: true, range: true, digest: ref.sha256, bytes: ref.size }));
    return;
  }
  if (command === 'inventory') {
    const source = new DatabaseSync(dbPath, {readOnly:true});
    try {
      const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[];
      const counts = Object.fromEntries(tables.map(({name}) => [name, (source.prepare(`SELECT count(*) n FROM "${name.replaceAll('"','""')}"`).get() as {n:number}).n]));
      const assets = source.prepare('SELECT * FROM assets').all() as unknown as AssetRow[];
      console.log(JSON.stringify({counts, assets: assets.map(a => ({id:a.id,size:a.size_bytes,object:a.storage_key.startsWith('s3:'),exists:a.storage_key.startsWith('s3:') || existsSync(safePath(config.media,a.storage_key))}))}));
    } finally { source.close(); }
    return;
  }
  const db = new Store(dbPath);
  try {
    if (command === 'restore') {
      for (const [id, root] of [['sounds',config.resources],['examples',config.examples],['voices',config.singingModels]])
        if (!process.argv[4] || process.argv[4] === id) await restoreTree(db,id,root);
      console.log(JSON.stringify({restored:true}));
    } else if (command === 'migrate') {
      const backupPath = `${dbPath}.before-s3.bak`;
      if (!existsSync(backupPath)) await backup(db.db, backupPath);
      let count = 0;
      for (const asset of db.all<AssetRow>('SELECT * FROM assets')) {
        if (asset.storage_key.startsWith('s3:')) { await binaries().read(assetRef(asset)); continue; }
        const bytes = await readFile(safePath(config.media, asset.storage_key));
        if (bytes.length !== asset.size_bytes) throw new Error('Source audio size mismatch');
        const ref = await binaries().put(bytes, asset.content_type);
        db.tx(() => db.run('UPDATE assets SET storage_key=? WHERE id=? AND storage_key=?', `s3:${ref.key}`, asset.id, asset.storage_key));
        count++;
      }
      console.log(JSON.stringify({ migrated_assets: count }));
    } else if (command === 'catalogs') {
      for (const [id, root] of [['sounds', config.resources], ['examples', config.examples], ['voices', config.singingModels]]) {
        if (!existsSync(root)) continue;
        const profiles: Record<string,unknown>[] = [];
        if (id === 'voices') for (const entry of readdirSync(root, {withFileTypes: true})) {
          const path = join(root, entry.name, 'profile.json');
          if (entry.isDirectory() && existsSync(path)) profiles.push(JSON.parse(readFileSync(path,'utf8')));
        }
        console.log(JSON.stringify(await publishTree(db, id, root, id === 'voices' ? externalVoiceRoots(root, profiles) : {})));
      }
    } else if (command === 'import') {
      const sourcePath = process.argv[4], identity = process.argv[5];
      if (!sourcePath || !identity) throw new Error('Usage: import target.db source.db source-identity');
      console.log(JSON.stringify(importWorkspace(db, sourcePath, identity)));
    } else throw new Error('Expected verify, inventory, migrate, catalogs, restore or import');
  } finally { db.db.close(); }
}

/** Import an immutable, consistently backed-up source; all relationships move in one transaction. */
export function importWorkspace(target: Store, sourcePath: string, identity: string) {
  const source = new DatabaseSync(sourcePath, {readOnly: true});
  const tables = ['projects','revisions','assets','operations','command_receipts','producer_runs','producer_events','audio_jobs','vocal_requests','vocal_jobs','vocal_renders','audio_exports'];
  try {
    const available = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(t=>t.name));
    const rows = Object.fromEntries(tables.map(table => [table, available.has(table) ? source.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[] : []]));
    const digest = sha256(Buffer.from(JSON.stringify(rows)));
    target.db.exec('CREATE TABLE IF NOT EXISTS storage_imports (identity TEXT PRIMARY KEY,digest TEXT NOT NULL,mapping JSON NOT NULL,created_at TEXT NOT NULL)');
    const previous = target.get<{digest:string}>('SELECT digest FROM storage_imports WHERE identity=?', identity);
    if (previous) {
      if (previous.digest !== digest) throw new Error('Source changed since import; reconcile from an immutable snapshot');
      return { reused: true, projects: rows.projects.length };
    }
    const mapping = new Map<string,string>();
    // Preserve the whole source graph if any entity ID already exists in the target.
    const collision = tables.some(table => rows[table].some(row => typeof row.id === 'string' && target.get(`SELECT 1 FROM ${table} WHERE id=?`, row.id)));
    if (collision) for (const table of tables) for (const row of rows[table])
      if (typeof row.id === 'string') mapping.set(row.id, sha256(Buffer.from(`${identity}\n${row.id}`)).slice(0,32));
    const encoded = new Set(['document','draft_checkpoint','forward','inverse','commands','state','payload','request','results','job_ids','snapshot','result']);
    const references = new Set(['id','project_id','draft_base_id','undo_of','run_id','request_id','asset_id','source_id','track_id','clip_id','part_id','bus_id','note_id','entity_id']);
    function remap(v: unknown, field = ''): unknown {
      if (typeof v === 'string') {
        if (encoded.has(field)) { try { return JSON.stringify(remap(JSON.parse(v), field)); } catch { /* Nullable/legacy text. */ } }
        if (references.has(field) || field === 'job_ids' || field === 'path') return mapping.get(v) ?? v;
        return v;
      }
      if (Array.isArray(v)) return v.map(x => remap(x,field));
      if (v && typeof v === 'object') {
        const delta = v as {op?:string;path?:string[]};
        return Object.fromEntries(Object.entries(v).map(([k,x]) => [field === 'syllables' ? mapping.get(k) ?? k : k,
          remap(x,k === 'value' && delta.op && Array.isArray(delta.path) ? delta.path.at(-1) ?? '' : k)]));
      }
      return v;
    }
    target.tx(() => {
      target.db.exec('PRAGMA defer_foreign_keys=ON');
      for (const table of tables) for (const original of rows[table]) {
        const row = remap(original) as Record<string, unknown>;
        // Idempotency identities are scoped to a project, not foreign keys.
        if (table === 'command_receipts') row.request_id = original.request_id;
        const columns = Object.keys(row);
        target.run(`INSERT INTO ${table} (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`, ...Object.values(row) as (string|number|null)[]);
      }
      target.run('INSERT INTO storage_imports VALUES (?,?,?,?)', identity, digest, JSON.stringify(Object.fromEntries(mapping)), new Date().toISOString());
    });
    return { reused: false, projects: rows.projects.length, remapped: mapping.size };
  } finally { source.close(); }
}
// Kept importable for real SQLite migration tests.
if (/storage\.(mjs|cjs)$/.test(process.argv[1] ?? '')) main().catch(() => { console.error('Storage operation failed; no credentials were logged. Check configuration and source integrity.'); process.exitCode = 1; });
