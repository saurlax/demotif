import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { config } from '../config'
import { ApiError } from '../errors'
import type { VocalVoice } from '@/types/vocal'
const profileSchema = z.object({
  id: z.string(), name: z.string(), language: z.string(), usage: z.string(),
  reference_root: z.string(), reference_revision: z.string(), experiment: z.string(),
  vocoder_checkpoint: z.string(), sampling_speedup: z.number(), cpu_threads: z.number(),
  speaker: z.string().default('opencpop'),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() })),
  capabilities: z.object({ manual_pitch: z.boolean(), manual_phoneme_duration: z.boolean(), automatic_pitch: z.boolean(), automatic_phoneme_duration: z.boolean() }),
})
export type InstalledProfile = z.infer<typeof profileSchema> & { path: string; info: VocalVoice }
export function installedProfiles(root = config.singingModels, python = config.singingPython): InstalledProfile[] {
  if (!existsSync(root)) return []
  const profiles: InstalledProfile[] = []
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const path = join(root, dir.name, 'profile.json')
    if (!existsSync(path)) continue
    try {
      const parsed = profileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      const missing = parsed.artifacts.find((a) => !existsSync(a.path))
      const reason = !existsSync(python) ? 'Install the singing worker environment' : missing ? `Missing voice file: ${basename(missing.path)}` : undefined
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

export function voiceCatalog(root = config.singingModels, python = config.singingPython): VocalVoice[] {
  const valid = installedProfiles(root, python)
  if (!existsSync(root)) return []
  const voices = valid.map((p) => p.info)
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const path = join(root, dir.name, 'profile.json')
    if (!existsSync(path) || valid.some((p) => p.path === path)) continue
    voices.push({ id: dir.name, name: dir.name, languages: [], ready: false,
      reason: 'Voice profile is invalid; reinstall its matching configuration', usage: '',
      controls: { pitch: false, vibrato: false, volume: false, automaticPitch: false, automaticTiming: false } })
  }
  return voices
}
