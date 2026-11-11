import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { config } from '../config'
import { ApiError } from '../errors'
import type { VocalVoice } from '@/types/vocal'
import modalOpencpop from '../../../workers/singing/modal-opencpop-profile.json'
const commonProfile = z.object({
  id: z.string(), name: z.string(), language: z.string(), usage: z.string(),
  reference_revision: z.string(), cpu_threads: z.number(),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() })),
  capabilities: z.object({ manual_pitch: z.boolean(), manual_phoneme_duration: z.boolean(), automatic_pitch: z.boolean(), automatic_phoneme_duration: z.boolean() }),
})
const profileSchema = z.union([commonProfile.extend({
  engine: z.literal('diffsinger').default('diffsinger'),
  reference_root: z.string(), reference_revision: z.string(), experiment: z.string(),
  vocoder_checkpoint: z.string(), sampling_speedup: z.number(), cpu_threads: z.number(),
  speaker: z.string().default('opencpop'),
}), commonProfile.extend({
  engine: z.literal('nnsvs'), language: z.literal('ja'),
  model_root: z.string(), reference_root: z.string(), validation_report: z.string(), dictionary_root: z.string(),
  nnsvs_version: z.literal('0.1.1'), intensity: z.string().regex(/^[0-3]{4}$/).default('0030'),
})])
export type InstalledProfile = z.infer<typeof profileSchema> & { path: string; info: VocalVoice; modal?: { app: string; environment: string } }
type ParsedProfile = z.infer<typeof profileSchema>
const digestCache = new Map<string, { stamp: string; digest: string }>()
function fileDigest(path: string) {
  const stat = statSync(path), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  const cached = digestCache.get(path)
  if (cached?.stamp === stamp) return cached.digest
  const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = openSync(path, 'r')
  try { let length: number; while ((length = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, length)) }
  finally { closeSync(fd) }
  const digest = hash.digest('hex'); digestCache.set(path, { stamp, digest }); return digest
}
const validationSchema = z.object({
  sample_rate: z.number().positive(), samples: z.number().int().positive(),
  peak: z.number().min(0.00001), rms: z.number().positive(),
  packages: z.object({ nnsvs: z.string(), utaupy: z.string() }),
  artifacts: z.array(z.object({ name: z.string(), sha256: z.string() })),
})
function japaneseReason(profile: Extract<ParsedProfile, { engine: 'nnsvs' }>) {
  if (!existsSync(profile.validation_report)) return 'Validate this Japanese voice with benchmark_japanese.py'
  try {
    const report = validationSchema.parse(JSON.parse(readFileSync(profile.validation_report, 'utf8')))
    if (report.packages.nnsvs !== profile.nnsvs_version || report.packages.utaupy !== '1.22.1') return 'Japanese voice validation uses an incompatible runtime'
    const required = ['config.yaml', 'qst.hed', 'kana2phonemes.table',
      ...['acoustic', 'duration', 'timelag', 'vocoder'].flatMap((part) => [`${part}_model.pth`, `${part}_model.yaml`]),
      ...['acoustic', 'duration', 'timelag'].flatMap((part) => [
        ...['min', 'scale'].map((field) => `in_${part}_scaler_${field}.npy`),
        ...['mean', 'var', 'scale'].map((field) => `out_${part}_scaler_${field}.npy`),
      ]), ...['mean', 'var', 'scale'].map((field) => `in_vocoder_scaler_${field}.npy`)]
    for (const name of required) {
      const path = join(profile.model_root, name), artifact = profile.artifacts.find((a) => a.path === path)
      if (!artifact || !existsSync(path)) return `Missing Japanese voice component: ${name}`
      if (!report.artifacts.some((a) => a.name === name && a.sha256 === artifact.sha256)) return `Revalidate Japanese voice component: ${name}`
    }
    if (!existsSync(join(profile.reference_root, 'sifigan/models/generator.py'))) return 'Install the matching native SiFiGAN source'
    for (const name of ['sys.dic', 'unk.dic', 'matrix.bin', 'char.bin']) {
      if (!profile.artifacts.some((a) => a.path === join(/* turbopackIgnore: true */ profile.dictionary_root, name))) return `Install and fingerprint the Japanese reading dictionary: ${name}`
    }
    for (const artifact of profile.artifacts) if (fileDigest(artifact.path) !== artifact.sha256) return `Changed voice file: ${basename(artifact.path)}; revalidate this voice`
  } catch { return 'Japanese voice validation is invalid; rerun benchmark_japanese.py' }
}
export function installedProfiles(root = config.singingModels, python = config.singingPython, nnsvsPython = config.nnsvsPython): InstalledProfile[] {
  const profiles: InstalledProfile[] = []
  if (root === config.singingModels) {
    const ritsu = {
      id: 'ritsu-crisscross-2824-ja', name: 'Namine Ritsu CRISSCROSS', language: 'ja', engine: 'nnsvs',
      usage: 'https://www.canon-voice.com/terms/',
      reference_revision: '936e4d00b1aaee297f571aeae6a9ca28ee1b8b77dbc3725e86cabee3cf0bb3d5',
      cpu_threads: 2, artifacts: [], model_root: '/models/ritsu.zip', reference_root: '/opt/sifigan',
      dictionary_root: '/var/lib/mecab/dic/open-jtalk/naist-jdic', validation_report: '',
      nnsvs_version: '0.1.1',
      capabilities: { manual_pitch: false, manual_phoneme_duration: true, automatic_pitch: true, automatic_phoneme_duration: true },
    }
    for (const { manifest, modal } of [
      { manifest: modalOpencpop, modal: config.singingModal },
      { manifest: ritsu, modal: config.singingJaModal },
    ]) {
      if (!modal.app) continue
      const parsed = profileSchema.parse(manifest)
      profiles.push({ ...parsed, path: '', modal, info: {
        id: parsed.id, name: parsed.name, languages: [parsed.language], ready: true, usage: parsed.usage,
        controls: { pitch: parsed.capabilities.manual_pitch, vibrato: parsed.capabilities.manual_pitch, volume: true,
          automaticPitch: parsed.capabilities.automatic_pitch, automaticTiming: parsed.capabilities.automatic_phoneme_duration },
      } })
    }
    return profiles
  }
  for (const dir of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (!dir.isDirectory()) continue
    const path = join(root, dir.name, 'profile.json')
    if (!existsSync(path)) continue
    try {
      const parsed = profileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      const missing = parsed.artifacts.find((a) => !existsSync(a.path))
      const executable = parsed.engine === 'nnsvs' ? nnsvsPython : python
      const reason = !existsSync(executable) ? `Install the ${parsed.engine === 'nnsvs' ? 'Japanese NNSVS' : 'singing worker'} environment`
        : missing ? `Missing voice file: ${basename(missing.path)}` : parsed.engine === 'nnsvs' ? japaneseReason(parsed) : undefined
      profiles.push({ ...parsed, path, info: {
        id: parsed.id, name: parsed.name, languages: [parsed.language], ready: !reason, reason, usage: parsed.usage,
        controls: { pitch: parsed.capabilities.manual_pitch, vibrato: parsed.capabilities.manual_pitch, volume: true,
          automaticPitch: parsed.capabilities.automatic_pitch, automaticTiming: parsed.capabilities.automatic_phoneme_duration },
      } })
    } catch { /* Incomplete operator-installed directories do not break normal music use. */ }
  }
  return profiles
}
export function requireVoice(id: string, language: string) {
  const profile = installedProfiles().find((p) => p.id === id)
  if (!profile) throw new ApiError(503, 'voice_unavailable', 'The selected voice is not installed')
  if (!profile.info.ready) throw new ApiError(503, 'voice_unavailable', profile.info.reason!)
  if (profile.language !== language) throw new ApiError(400, 'voice_language', 'Select a language supported by this voice')
  return profile
}

export function voiceCatalog(root = config.singingModels, python = config.singingPython, nnsvsPython = config.nnsvsPython): VocalVoice[] {
  const valid = installedProfiles(root, python, nnsvsPython)
  const voices = valid.map((p) => p.info)
  if (root === config.singingModels) return voices
  for (const dir of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (!dir.isDirectory()) continue
    const path = join(root, dir.name, 'profile.json')
    if (!existsSync(path) || valid.some((p) => p.path === path || (p.modal && p.id === dir.name))) continue
    voices.push({ id: dir.name, name: dir.name, languages: [], ready: false,
      reason: 'Voice profile is invalid; reinstall its matching configuration', usage: '',
      controls: { pitch: false, vibrato: false, volume: false, automaticPitch: false, automaticTiming: false } })
  }
  return voices
}
