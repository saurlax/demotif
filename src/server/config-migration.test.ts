import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { planMigration, applyMigration } from '../../scripts/migrate-config.mjs';

const roots: string[] = [];
function setup(content: string) { const root = mkdtempSync(join(tmpdir(), 'demotif-migration-')); roots.push(root); writeFileSync(join(root, '.env.local'), content); return root; }
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
it('dry-runs without writing, merges one credential, selects local explicitly and applies idempotently', () => {
  const original = 'DEMOTIF_OPENROUTER_API_KEY="test#secret"\nDEMOTIF_UPSTREAM_API=http://backend.example/api\nUNRELATED="two lines\nsecond"\n';
  const root = setup(original), plan = planMigration(root, {local:true});
  expect(readFileSync(join(root, '.env.local'), 'utf8')).toBe(original); expect(existsSync(join(root,'demotif.config.json'))).toBe(false);
  applyMigration(plan);
  const env = parseEnv(readFileSync(join(root,'.env.local'),'utf8'));
  expect(env.DEMOTIF_LLM_API_KEY).toBe('test#secret'); expect(env.DEMOTIF_LLM_BASE_URL).toBe('https://openrouter.ai/api/v1'); expect(env.UNRELATED).toBe('two lines\nsecond'); expect(env.DEMOTIF_UPSTREAM_API).toBeUndefined();
  expect(readFileSync(join(root,'.env.local.config-backup'),'utf8')).toBe(original);
  expect(JSON.parse(readFileSync(join(root,'demotif.config.json'),'utf8')).runtime.mode).toBe('local');
  expect(planMigration(root,{local:true}).writes).toHaveLength(0);
});
it('preserves explicit proxy intent unless local is requested', () => {
  const root=setup('DEMOTIF_UPSTREAM_API=http://backend.example/api\n'); applyMigration(planMigration(root));
  expect(JSON.parse(readFileSync(join(root,'demotif.config.json'),'utf8')).runtime).toEqual({mode:'proxy',upstream:'http://backend.example/api'});
});
it('refuses conflicting keys, custom layouts and non-OpenRouter endpoints without writes', () => {
  for (const content of ['DEMOTIF_PRODUCER_API_KEY=a\nDEMOTIF_OPENROUTER_API_KEY=b\n','DEMOTIF_MEDIA_ROOT=./different\n','DEMOTIF_PRODUCER_BASE_URL=https://other.example/v1\n','DEMOTIF_PRODUCER_MODEL_SETTINGS={bad}\n']) {
    const root=setup(content); expect(()=>planMigration(root)).toThrow(); expect(readFileSync(join(root,'.env.local'),'utf8')).toBe(content); expect(existsSync(join(root,'demotif.config.json'))).toBe(false);
  }
});
it('does not overwrite a backup or apply a stale plan', () => {
  const root=setup('DEMOTIF_OPENROUTER_API_KEY=test\n'), plan=planMigration(root);
  writeFileSync(join(root,'.env.local.config-backup'),'preserved'); expect(()=>applyMigration(plan)).toThrow('originals retained'); expect(readFileSync(join(root,'.env.local.config-backup'),'utf8')).toBe('preserved');
  writeFileSync(join(root,'.env.local'),'NEW=value\n'); expect(()=>applyMigration(plan)).toThrow(); expect(readFileSync(join(root,'.env.local'),'utf8')).toBe('NEW=value\n');
});
