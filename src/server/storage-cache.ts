import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { binaries, verify, sha256, type BinaryRef } from './storage';
import { config } from './config';

/** Hash-addressed cache. A partial or corrupt download never becomes a native input. */
export async function materialize(ref: BinaryRef, signal?: AbortSignal) {
  if (!(ref.sha256 && /^[a-f0-9]{64}$/.test(ref.sha256)) && !(ref.md5 && /^[a-f0-9]{32}$/.test(ref.md5))) throw new Error('Invalid artifact digest');
  const directory = join(config.media, '.object-cache');
  const target = join(directory, ref.sha256 ?? sha256(Buffer.from(ref.key)));
  try { verify(await readFile(target), ref); return target; } catch { /* Cache miss or corruption. */ }
  const bytes = await binaries().read(ref, signal);
  verify(bytes, ref);
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  const partial = `${target}.${randomUUID()}.partial`;
  try { await writeFile(partial, bytes, { flag: 'wx' }); await rename(partial, target); }
  finally { await rm(partial, { force: true }); }
  return target;
}
