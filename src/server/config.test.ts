import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfiguration, runtimeEnvironmentNames } from './settings';

const roots: string[] = [];
function root(settings?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'demotif-config-')); roots.push(directory);
  if (settings !== undefined) writeFileSync(join(directory, 'demotif.config.json'), JSON.stringify(settings));
  return directory;
}
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
it('has explicit runtime inputs, local defaults, one data root and OS-derived executables', () => {
  const directory = root(), c = loadConfiguration(directory, {}, 'win32');
  expect(runtimeEnvironmentNames).toEqual(expect.arrayContaining([
    'DEMOTIF_YUE2_MODAL_APP', 'DEMOTIF_YUE2_MODAL_ENVIRONMENT', 'DEMOTIF_YUE2_MODAL_GPU',
  ]));
  expect(c.yue2).toEqual({ app: '', environment: 'main', gpu: '' });
  expect(c.upstream).toBe(''); expect(c.environment).toBe('local');
  expect(c.database).toBe(join(directory, 'data', 'demotif.db'));
  expect(c.analysisPython).toBe(join(directory, 'analysis/.venv/Scripts/python.exe'));
  expect(c.singingPython).toBe(join(directory, 'workers/singing/.venv/Scripts/python.exe'));
  expect(loadConfiguration(directory, {}, 'linux').nnsvsPython).toBe(join(directory, 'workers/singing/.venv-nnsvs/bin/python'));
  expect(c.llmURL).toBe('https://openrouter.ai/api/v1'); expect(c.llmKey).toBe(''); expect(c.producerModel).toBe('deepseek/deepseek-v4.1-flash');
  const custom = loadConfiguration(directory, { DEMOTIF_DATA_DIR: './other', DEMOTIF_ELEVENLABS_API_KEY:'audio-only-secret', DEMOTIF_LLM_API_KEY: 'test-secret', DEMOTIF_LLM_BASE_URL: 'https://openrouter.ai/api/v1/' });
  expect(custom.media).toBe(join(directory, 'other/media')); expect(custom.singingModels).toBe(join(directory, 'other/models'));
  expect(custom.elevenlabsKey).toBe('audio-only-secret'); expect(custom.llmKey).toBe('test-secret'); expect(custom.llmURL).toBe(c.llmURL);
});
it('configures StepFun separately and validates endpoints without leaking credentials', () => {
  const defaults=loadConfiguration(root(),{});
  expect(defaults.stepfunKey).toBe('');
  expect(defaults.stepfunURL).toBe('https://api.stepfun.com/v1');
  expect(defaults.realtime.voice).toBe('wenrounansheng');
  expect(defaults.realtime.model).toBe('stepaudio-3-realtime-preview');
  const custom=loadConfiguration(root({producer:{realtime:{voice:'custom'}}}),{STEPFUN_API_KEY:'private',STEPFUN_BASE_URL:'https://step.example/v1/'});
  expect(custom.stepfunKey).toBe('private'); expect(custom.stepfunURL).toBe('https://step.example/v1');
  expect(custom.realtime.voice).toBe('custom');
  expect(custom.realtime).not.toHaveProperty('energy_awakeness_threshold');
  expect(()=>loadConfiguration(root(),{STEPFUN_BASE_URL:'https://private@example.com/v1'})).toThrow('Invalid STEPFUN_BASE_URL');
  expect(()=>loadConfiguration(root({producer:{realtime:{voice:'secret',extra:'private'}}}),{})).toThrow('producer.realtime');
});
it('requires explicit proxy mode and validates configuration without printing values', () => {
  expect(loadConfiguration(root({ runtime: { mode: 'proxy', upstream: 'http://backend.example/api' } }), {}).upstream).toBe('http://backend.example/api');
  for (const value of [{ runtime: { mode: 'proxy' } }, { producer: { apiKey: 'do-not-log' } }, { extra: 'do-not-log' }]) {
    try { loadConfiguration(root(value), {}); throw new Error('Should reject'); }
    catch (e) { expect(String(e)).toContain('Invalid demotif.config.json'); expect(String(e)).not.toContain('do-not-log'); }
  }
  expect(() => loadConfiguration(root(), { DEMOTIF_UPSTREAM_API: 'do-not-log' })).toThrow('DEMOTIF_UPSTREAM_API');
  expect(() => loadConfiguration(root(), { DEMOTIF_LLM_BASE_URL: 'https://secret@example.com/v1' })).toThrow('Invalid DEMOTIF_LLM_BASE_URL');
  const directory = root(); writeFileSync(join(directory, 'demotif.config.json'), '{ "secret-value": ');
  expect(() => loadConfiguration(directory, {})).toThrow('Cannot parse');
});
