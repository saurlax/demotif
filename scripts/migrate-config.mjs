import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, constants } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateSettings, runtimeEnvironmentNames, testEnvironmentNames } from '../src/server/settings.ts';

const oldNames = ['DATABASE_URL','MEDIA_ROOT','EXAMPLES_ROOT','ENVIRONMENT','MAX_UPLOAD_BYTES','UPSTREAM_API','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_PREFIX','PRODUCER_MODEL','PRODUCER_API','PRODUCER_BASE_URL','PRODUCER_MODEL_SETTINGS','PRODUCER_API_KEY','AUDIO_BASE_URL','AUDIO_API_KEY','AUDIO_BIZ_ID','OPENROUTER_API_KEY','OPENROUTER_BASE_URL','SINGING_PYTHON','NNSVS_PYTHON','SINGING_MODELS_ROOT','SINGING_DEVICE','ANALYSIS_PYTHON'].map(n => 'DEMOTIF_' + n);
const envFiles = ['.env','.env.local','.env.development','.env.development.local','.env.production','.env.production.local','.env.test','.env.test.local'];
function encodeEnv(entries) {
  const text = Object.entries(entries).map(([name, value]) => {
    const quote = ['"', "'", '`'].find(q => !value.includes(q));
    if (!quote) throw new Error(`Cannot safely serialize ${name}; migrate it manually.`);
    return `${name}=${quote}${value}${quote}`;
  }).join('\n') + '\n';
  const parsed = parseEnv(text);
  if (Object.entries(entries).some(([name, value]) => parsed[name] !== value)) throw new Error('Environment round-trip validation failed; no files changed.');
  return text;
}
export function planMigration(root, { local = false } = {}) {
  const files = envFiles.map(name => ({ path: resolve(root, name), name })).filter(f => existsSync(f.path)).map(f => ({ ...f, original: readFileSync(f.path, 'utf8') }));
  const values = files.map(f => parseEnv(f.original));
  const get = suffix => {
    const name = 'DEMOTIF_' + suffix, found = [...new Set(values.map(v => v[name]).filter(v => v !== undefined && v !== ''))];
    if (found.length > 1) throw new Error(`Conflicting ${name} across environment files; no files changed.`);
    return found[0];
  };
  const configurationPath = resolve(root, 'demotif.config.json');
  const originalConfig = existsSync(configurationPath) ? readFileSync(configurationPath, 'utf8') : null;
  let settings;
  try { settings = originalConfig ? JSON.parse(originalConfig) : {}; } catch { throw new Error('Cannot parse demotif.config.json.'); }
  validateSettings(settings);
  const set = (section, name, value) => {
    if (value === undefined) return;
    settings[section] ??= {};
    if (settings[section][name] !== undefined && JSON.stringify(settings[section][name]) !== JSON.stringify(value)) throw new Error(`Conflicting configuration field ${section}.${name}; no files changed.`);
    settings[section][name] = value;
  };
  const keys = [...new Set(['LLM_API_KEY','PRODUCER_API_KEY','AUDIO_API_KEY','OPENROUTER_API_KEY'].map(get).filter(Boolean))];
  if (keys.length > 1) throw new Error('Different legacy model credentials cannot be combined automatically. Set DEMOTIF_LLM_API_KEY explicitly and remove obsolete credentials.');
  const urls = [...new Set(['LLM_BASE_URL','PRODUCER_BASE_URL','AUDIO_BASE_URL','OPENROUTER_BASE_URL'].map(get).filter(Boolean).map(v => v.replace(/\/+$/, '')))];
  if (urls.length > 1 || urls.some(v => v !== 'https://openrouter.ai/api/v1')) throw new Error('Legacy model endpoints require manual conversion to OpenRouter; no files changed.');
  const database = get('DATABASE_URL');
  if (database && !/^sqlite(?:\+aiosqlite)?:\/\/\//.test(database)) throw new Error('Cannot migrate DATABASE_URL; expected SQLite.');
  const dbPath = database ? resolve(root, database.replace(/^sqlite(?:\+aiosqlite)?:\/\/\//, '')) : null;
  const data = get('DATA_DIR') ? resolve(root, get('DATA_DIR')) : dbPath ? dirname(dbPath) : resolve(root, 'data');
  if (dbPath && (basename(dbPath) !== 'demotif.db' || dirname(dbPath) !== data)) throw new Error('Database layout conflicts with DEMOTIF_DATA_DIR; no files moved.');
  for (const [name, sub] of [['MEDIA_ROOT','media'],['EXAMPLES_ROOT','examples'],['SINGING_MODELS_ROOT','models']]) if (get(name) && resolve(root, get(name)) !== resolve(data, sub)) throw new Error(`Custom ${name} conflicts with the unified data layout; no files moved.`);
  for (const [name, dir] of [['ANALYSIS_PYTHON','analysis/.venv'],['SINGING_PYTHON','workers/singing/.venv'],['NNSVS_PYTHON','workers/singing/.venv-nnsvs']]) if (get(name) && !['bin/python','Scripts/python.exe'].some(tail => resolve(root, get(name)) === resolve(root, dir, tail))) throw new Error(`Custom ${name} must use the standard virtual environment location.`);
  if (get('MAX_UPLOAD_BYTES') && get('MAX_UPLOAD_BYTES') !== '104857600') throw new Error('Custom MAX_UPLOAD_BYTES requires manual resolution.');
  if (get('PRODUCER_API') && get('PRODUCER_API') !== 'chat') throw new Error('PRODUCER_API requires conversion to OpenRouter chat.');
  if (local) settings.runtime = { mode: 'local' };
  else if (get('UPSTREAM_API')) { set('runtime', 'mode', 'proxy'); set('runtime', 'upstream', get('UPSTREAM_API')); }
  for (const [old, field] of [['S3_ENDPOINT','endpoint'],['S3_BUCKET','bucket'],['S3_REGION','region'],['S3_PREFIX','prefix']]) set('storage', field, get(old));
  set('producer', 'model', get('PRODUCER_MODEL')); set('singing', 'device', get('SINGING_DEVICE'));
  if (get('PRODUCER_MODEL_SETTINGS')) {
    let parsed; try { parsed = JSON.parse(get('PRODUCER_MODEL_SETTINGS')); } catch { throw new Error('Invalid PRODUCER_MODEL_SETTINGS JSON.'); }
    set('producer', 'settings', parsed);
  }
  validateSettings(settings);
  const removed = [...new Set(values.flatMap(v => Object.keys(v).filter(n => oldNames.includes(n))))];
  const unknown = [...new Set(values.flatMap(v => Object.keys(v).filter(n => n.startsWith('DEMOTIF_') && !oldNames.includes(n) && !runtimeEnvironmentNames.includes(n) && !testEnvironmentNames.has(n))))];
  if (unknown.length) throw new Error(`Unsupported environment names: ${unknown.join(', ')}`);
  const writes = files.map((file, i) => {
    const entries = { ...values[i] }; for (const n of oldNames) delete entries[n];
    const hadModel = ['PRODUCER_API_KEY','AUDIO_API_KEY','OPENROUTER_API_KEY','LLM_API_KEY'].some(n => values[i]['DEMOTIF_' + n]);
    if (hadModel && keys[0]) { entries.DEMOTIF_LLM_API_KEY = keys[0]; entries.DEMOTIF_LLM_BASE_URL = urls[0] || 'https://openrouter.ai/api/v1'; }
    if (data !== resolve(root, 'data')) entries.DEMOTIF_DATA_DIR = data;
    return { path: file.path, original: file.original, content: encodeEnv(entries) };
  }).filter(f => JSON.stringify(parseEnv(f.original)) !== JSON.stringify(parseEnv(f.content)));
  if (removed.length || (local && settings.runtime?.mode === 'local' && originalConfig && JSON.parse(originalConfig).runtime?.mode === 'proxy')) writes.push({ path: configurationPath, original: originalConfig, content: JSON.stringify(settings, null, 2) + '\n' });
  return { writes: writes.filter(f => f.content !== f.original), removed };
}
export function applyMigration(plan) {
  const staged = [], committed = [];
  try {
    for (const file of plan.writes) {
      if ((existsSync(file.path) ? readFileSync(file.path, 'utf8') : null) !== file.original) throw new Error('Configuration changed after planning; retry the dry run.');
      if (file.original !== null) copyFileSync(file.path, file.path + '.config-backup', constants.COPYFILE_EXCL);
      const temp = file.path + '.config-pending'; writeFileSync(temp, file.content, { flag: 'wx', mode: 0o600 }); staged.push({ ...file, temp });
    }
    for (const file of staged) { renameSync(file.temp, file.path); committed.push(file); }
  } catch {
    for (const file of committed.reverse()) { if (file.original === null) unlinkSync(file.path); else writeFileSync(file.path, file.original, { mode: 0o600 }); }
    throw new Error('Configuration migration stopped; originals retained. Check backups and pending files before retrying.');
  } finally { for (const file of staged) if (existsSync(file.temp)) unlinkSync(file.temp); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = process.argv.slice(2); if (options.some(o => !['--apply','--local'].includes(o))) throw new Error('Usage: npm run migrate:config -- [--apply] [--local]');
    const plan = planMigration(process.cwd(), { local: options.includes('--local') });
    console.log(JSON.stringify({ mode: options.includes('--apply') ? 'apply' : 'dry-run', files: plan.writes.map(f => basename(f.path)), removedNames: plan.removed }));
    if (options.includes('--apply')) applyMigration(plan);
  } catch (e) { console.error(e instanceof Error ? e.message : 'Configuration migration failed.'); process.exitCode = 1; }
}
