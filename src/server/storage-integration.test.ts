import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './db';
import { createProject, applyCommands } from './projects';
import { prepareAsset, publishAsset, materializeAsset } from './media';
import { config } from './config';
import { publishTree, restoreTree } from './catalogs';
import { binaries } from './storage';
import { importWorkspace } from '../../scripts/storage';
import { loadExample } from './examples';
import { sha256 } from './storage';
let directory: string, oldMedia: string, db: Store;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(),'demotif-storage-')); oldMedia = config.media; config.media = join(directory,'cache'); db = new Store(join(directory,'target.db')); });
afterEach(() => { db.db.close(); config.media = oldMedia; rmSync(directory,{recursive:true,force:true}); });
it('publishes only verified audio and rolls back ownership without losing immutable bytes', async () => {
  const p = createProject(db,'P');
  const store = binaries();
  const failure = vi.spyOn(store,'put').mockRejectedValueOnce(Error('unavailable'));
  await expect(prepareAsset(p.id,'take.wav','audio/wav',Uint8Array.of(1))).rejects.toThrow();
  expect(db.all('SELECT * FROM assets')).toHaveLength(0); failure.mockRestore();
  const prepared = await prepareAsset(p.id,'take.wav','audio/wav',Uint8Array.of(1,2,3));
  expect(() => db.tx(() => { publishAsset(db,prepared); throw Error('rollback'); })).toThrow();
  expect(db.all('SELECT * FROM assets')).toHaveLength(0);
  publishAsset(db,prepared);
  const path = await materializeAsset(prepared); writeFileSync(path,'corrupt');
  expect(readFileSync(await materializeAsset(prepared))).toEqual(Buffer.from([1,2,3]));
});
it('restores catalog contents and relocates native profile paths from object storage', async () => {
  const original = join(directory,'original'), restored = join(directory,'restored'); mkdirSync(original);
  writeFileSync(join(original,'model.bin'),Buffer.from([3,4,5]));
  writeFileSync(join(original,'profile.json'),JSON.stringify({model_root:original,artifacts:[{path:join(original,'model.bin')}]}));
  await publishTree(db,'voices',original);
  rmSync(original,{recursive:true});
  await restoreTree(db,'voices',restored);
  expect(JSON.parse(readFileSync(join(restored,'profile.json'),'utf8')).artifacts[0].path).toBe(join(restored,'model.bin'));
  expect(readFileSync(join(restored,'model.bin'))).toEqual(Buffer.from([3,4,5]));
});
it('imports divergent SQLite project graphs atomically and resumes without duplicates', () => {
  const path = join(directory,'source.db'), source = new Store(path);
  const project = createProject(source,'Original');
  applyCommands(source,project.id,{expected_version:1,commands:[{type:'project.rename',name:project.id}]});
  source.db.close();
  db.tx(() => {
    db.db.exec('PRAGMA defer_foreign_keys=ON');
    const occupied = createProject(db,'Existing');
    db.run('UPDATE projects SET id=? WHERE id=?',project.id,occupied.id);
    db.run('UPDATE operations SET project_id=? WHERE project_id=?',project.id,occupied.id);
  });
  expect(importWorkspace(db,path,'fixture')).toMatchObject({reused:false,projects:1});
  expect(db.all('SELECT * FROM projects')).toHaveLength(2);
  const imported = db.get<{id:string;name:string}>('SELECT id,name FROM projects WHERE name=?',project.id)!;
  expect(imported.id).not.toBe(project.id); expect(imported.name).toBe(project.id);
  expect(JSON.parse(db.get<{forward:string}>('SELECT forward FROM operations WHERE project_id=? AND version=2',imported.id)!.forward)[0].value).toBe(project.id);
  expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
  expect(importWorkspace(db,path,'fixture')).toMatchObject({reused:true});
  expect(db.all('SELECT * FROM projects')).toHaveLength(2);
});
it('opens a cold-cache audio example as an independently owned clean draft', async () => {
  const root = join(directory, 'examples'), pack = join(root, 'sample'); mkdirSync(pack, {recursive:true});
  const bytes = Buffer.from([1,2,3]), digest = sha256(bytes);
  writeFileSync(join(pack,'take.wav'),bytes);
  writeFileSync(join(pack,'manifest.json'),JSON.stringify({name:'Sample',document:{},media:[{id:digest,filename:'take.wav',file:'take.wav'}]}));
  await publishTree(db,'examples',root); rmSync(root,{recursive:true}); await restoreTree(db,'examples',root);
  const old = config.examples; config.examples = root;
  try {
    const draft = await loadExample(db,'sample'); expect(draft.has_unsaved_changes).toBe(false);
    expect(db.get<{storage_key:string}>('SELECT storage_key FROM assets WHERE project_id=?',draft.id)!.storage_key).toMatch(/^s3:objects\//);
  } finally { config.examples = old; }
});
