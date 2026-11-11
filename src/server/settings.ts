import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {defaultProducerModel} from '../shared/producer-models.mjs';

export const runtimeEnvironmentNames = ['DEMOTIF_ELEVENLABS_API_KEY', 'DEMOTIF_LLM_API_KEY', 'DEMOTIF_LLM_BASE_URL', 'DEMOTIF_S3_ACCESS_KEY_ID', 'DEMOTIF_S3_SECRET_ACCESS_KEY', 'DEMOTIF_DATA_DIR', 'STEPFUN_API_KEY', 'STEPFUN_BASE_URL', 'DEMOTIF_YUE2_MODAL_APP', 'DEMOTIF_YUE2_MODAL_ENVIRONMENT', 'DEMOTIF_YUE2_MODAL_GPU', 'DEMOTIF_SINGING_MODAL_APP', 'DEMOTIF_SINGING_MODAL_ENVIRONMENT', 'DEMOTIF_SINGING_JA_MODAL_APP', 'DEMOTIF_SINGING_JA_MODAL_ENVIRONMENT', 'DEMOTIF_MEDIA_MODAL_APP', 'DEMOTIF_MEDIA_MODAL_ENVIRONMENT'] as const;
export const testEnvironmentNames = new Set(['DEMOTIF_LIVE_MODEL_TEST', 'DEMOTIF_TEST_NATIVE_SINGING', 'DEMOTIF_LIVE_YUE2_TEST']);
const endpoint = z.string().url().refine(value => {
  const u = new URL(value);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
});
export const settingsSchema = z.strictObject({
  runtime: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('local') }),
    z.strictObject({ mode: z.literal('proxy'), upstream: endpoint }),
  ]).default({ mode: 'local' }),
  storage: z.strictObject({ endpoint: endpoint.optional(), bucket: z.string().min(1).optional(), region: z.string().min(1).default('us-east-1'), prefix: z.string().min(1).default('demotif/') }).prefault({}),
  producer: z.strictObject({
    model: z.string().max(160).default(defaultProducerModel), settings: z.record(z.string(), z.unknown()).default({}),
    realtime: z.strictObject({
      model: z.string().min(1).max(160).default('stepaudio-3-realtime-preview'),
      voice: z.string().min(1).max(160).default('wenrounansheng'),
    }).prefault({}),
  }).prefault({}),
  singing: z.strictObject({ device: z.enum(['cpu', 'cuda', 'mps']).default('cpu') }).prefault({}),
});
export function validateSettings(value: unknown) {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid demotif.config.json fields: ${[...new Set(parsed.error.issues.map(i => i.path.join('.') || 'root'))].join(', ')}`);
  return parsed.data;
}
export function loadConfiguration(root = process.cwd(), environment: Record<string, string | undefined> = process.env, platform = process.platform) {
  const obsolete = Object.keys(environment).filter(name => name.startsWith('DEMOTIF_') && !runtimeEnvironmentNames.includes(name as typeof runtimeEnvironmentNames[number]) && !testEnvironmentNames.has(name) && environment[name] !== undefined);
  if (obsolete.length) throw new Error(`Unsupported environment variables: ${obsolete.join(', ')}. Run npm run migrate:config for a dry run.`);
  const filename = resolve(root, 'demotif.config.json');
  let raw: unknown = {};
  if (existsSync(filename)) {
    try { raw = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { throw new Error('Cannot parse demotif.config.json; check JSON syntax.'); }
  }
  const settings = validateSettings(raw);
  const data = resolve(root, environment.DEMOTIF_DATA_DIR || 'data');
  const llmURL = environment.DEMOTIF_LLM_BASE_URL || 'https://openrouter.ai/api/v1';
  if (!endpoint.safeParse(llmURL).success) throw new Error('Invalid DEMOTIF_LLM_BASE_URL; use an HTTP(S) API endpoint without credentials or query parameters.');
  const stepfunURL = environment.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1';
  if (!endpoint.safeParse(stepfunURL).success) throw new Error('Invalid STEPFUN_BASE_URL; use an HTTP(S) API endpoint without credentials or query parameters.');
  const python = (directory: string) => resolve(root, directory, ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  return {
    upstream: settings.runtime.mode === 'proxy' ? settings.runtime.upstream : '',
    environment: settings.runtime.mode,
    s3: { ...settings.storage, endpoint: settings.storage.endpoint || '', bucket: settings.storage.bucket || '', accessKeyId: environment.DEMOTIF_S3_ACCESS_KEY_ID || '', secretAccessKey: environment.DEMOTIF_S3_SECRET_ACCESS_KEY || '' },
    database: resolve(data, 'demotif.db'), media: resolve(data, 'media'), examples: resolve(data, 'examples'), resources: resolve(root, 'resources/sounds'), maxUpload: 104857600,
    elevenlabsKey: environment.DEMOTIF_ELEVENLABS_API_KEY || '',
    yue2: {
      app: environment.DEMOTIF_YUE2_MODAL_APP?.trim() || '',
      environment: environment.DEMOTIF_YUE2_MODAL_ENVIRONMENT?.trim() || 'main',
      gpu: environment.DEMOTIF_YUE2_MODAL_GPU?.trim() || '',
    },
    singingModal: {
      app: environment.DEMOTIF_SINGING_MODAL_APP?.trim() || '',
      environment: environment.DEMOTIF_SINGING_MODAL_ENVIRONMENT?.trim() || 'main',
    },
    singingJaModal: {
      app: environment.DEMOTIF_SINGING_JA_MODAL_APP?.trim() || '',
      environment: environment.DEMOTIF_SINGING_JA_MODAL_ENVIRONMENT?.trim() || 'main',
    },
    mediaModal: {
      app: environment.DEMOTIF_MEDIA_MODAL_APP?.trim() || '',
      environment: environment.DEMOTIF_MEDIA_MODAL_ENVIRONMENT?.trim() || 'main',
    },
    stepfunKey: environment.STEPFUN_API_KEY || '', stepfunURL: stepfunURL.replace(/\/+$/, ''), realtime: settings.producer.realtime,
    llmKey: environment.DEMOTIF_LLM_API_KEY || '', llmURL: llmURL.replace(/\/+$/, ''),
    producerModel: settings.producer.model || defaultProducerModel, producerSettings: settings.producer.settings,
    singingPython: python('workers/singing/.venv'), nnsvsPython: python('workers/singing/.venv-nnsvs'), analysisPython: python('analysis/.venv'), singingModels: resolve(data, 'models'), singingDevice: settings.singing.device,
  };
}
