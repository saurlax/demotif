import { readdir, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './db';
import { binaries, sha256, type BinaryRef } from './storage';
import { materialize } from './storage-cache';
import { safePath } from './media';

interface Catalog { files: { path: string; ref: BinaryRef }[]; roots?: Record<string, string> }
export async function publishTree(db: Store, id: string, root: string, extraRoots: Record<string, string> = {}) {
  const manifest: Catalog = { files: [], roots: { [root]: '', ...extraRoots } };
  async function walk(directory: string, destination: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', '__pycache__', '.venv', '.object-cache'].includes(entry.name) || entry.name.endsWith('.pyc')) continue;
      const path = join(directory, entry.name), name = [destination, entry.name].filter(Boolean).join('/');
      if (entry.isSymbolicLink()) throw new Error('Catalog contains a symbolic link');
      if (entry.isDirectory()) await walk(path, name);
      else if (entry.isFile()) manifest.files.push({ path: name, ref: await binaries().put(await readFile(path), 'application/octet-stream') });
    }
  }
  await walk(root, '');
  for (const [source, destination] of Object.entries(extraRoots)) await walk(source, destination);
  db.run('INSERT INTO storage_catalogs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest,updated_at=excluded.updated_at', id, JSON.stringify(manifest), new Date().toISOString());
  return { id, files: manifest.files.length, bytes: manifest.files.reduce((sum, f) => sum + f.ref.size, 0) };
}
export async function restoreTree(db: Store, id: string, root: string) {
  const row = db.get<{manifest: string}>('SELECT manifest FROM storage_catalogs WHERE id=?', id);
  if (!row) return;
  const manifest = JSON.parse(row.manifest) as Catalog;
  const roots = Object.entries(manifest.roots ?? {}).sort((a,b) => b[0].length - a[0].length);
  function relocate(value: unknown): unknown {
    if (typeof value === 'string') for (const [source, destination] of roots) {
      if (value === source || value.startsWith(source + '/') || value.startsWith(source + '\\'))
        return join(root, destination, ...value.slice(source.length).split(/[\\/]/).filter(Boolean));
    }
    if (Array.isArray(value)) return value.map(relocate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, relocate(v)]));
    return value;
  }
  for (const file of manifest.files) {
    const target = safePath(root, file.path);
    let bytes = await readFile(await materialize(file.ref));
    if (file.path.endsWith('.json')) bytes = Buffer.from(JSON.stringify(relocate(JSON.parse(bytes.toString('utf8')))));
    try { if (sha256(await readFile(target)) === sha256(bytes)) continue; } catch { /* Cache miss. */ }
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.${randomUUID()}.partial`;
    await writeFile(partial, bytes, { flag: 'wx' }); await rename(partial, target);
  }
}
export function externalVoiceRoots(modelRoot: string, profiles: Record<string, unknown>[]) {
  const roots: Record<string,string> = {};
  for (const profile of profiles) for (const key of ['reference_root', 'dictionary_root', 'model_root']) {
    const path = profile[key];
    if (typeof path !== 'string') continue;
    const rel = relative(modelRoot, path);
    if (rel.startsWith('..') || isAbsolute(rel)) roots[path] = `.external/${sha256(Buffer.from(path)).slice(0,16)}`;
  }
  return roots;
}
