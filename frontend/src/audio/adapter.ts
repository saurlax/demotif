import type {
  Project as StoredProject,
  Clip as StoredClip,
  Source,
} from '@/types/project'
import type { Asset, Clip, Project, MixerChannel } from './model'
import { mediaUrl } from '@/lib/api'

export const beatsPerBar = (signature: string) => {
  const [n, d] = signature.split('/').map(Number)
  return (n * 4) / d
}
export function renderSource(
  source: Source,
  projectId: string,
  tempo: number,
): Asset {
  const beat = 60 / tempo
  return {
    id: source.id,
    name: source.name,
    kind:
      source.kind === 'audio'
        ? 'import'
        : source.kind === 'drums'
          ? 'drums'
          : 'keys',
    variant: 0,
    bpm: tempo,
    duration: source.duration * (source.kind === 'audio' ? 1 : beat),
    notes: source.notes.map((n) => ({
      ...n,
      start: n.start * beat,
      duration: n.duration * beat,
    })),
    sound: source.sound,
    drumKit: source.drum_kit,
    synth: source.synth,
    url: source.asset_id ? mediaUrl(projectId, source.asset_id) : undefined,
    sampler: source.sampler
      ? {
          ...source.sampler,
          loopStart: source.sampler.loopStart ?? undefined,
          loopEnd: source.sampler.loopEnd ?? undefined,
        }
      : undefined,
    drumSamples: source.drum_samples.map((row) => ({
      ...row,
      url: mediaUrl(projectId, row.asset_id),
    })),
  }
}
export function renderClip(
  clip: StoredClip,
  source: Source | undefined,
  tempo: number,
): Clip {
  const beat = 60 / tempo,
    unit = source?.kind === 'audio' || (!source && clip.asset_id) ? 1 : beat
  return {
    id: clip.id,
    name: clip.name,
    assetId: clip.source_id ?? `media-${clip.asset_id}`,
    start: clip.start_beat * beat,
    offset: clip.offset * unit,
    duration:
      clip.source_duration != null
        ? clip.source_duration * unit
        : clip.length_beats * beat,
    gain: clip.gain,
    fadeIn: clip.fade_in * unit,
    fadeOut: clip.fade_out * unit,
    envelopeOffset: clip.envelope_offset * unit,
    envelopeDuration:
      clip.envelope_duration == null
        ? undefined
        : clip.envelope_duration * unit,
  }
}
export function renderProject(project: StoredProject): Project {
  const d = project.document,
    beat = 60 / d.tempo
  const channel = (c: typeof d.mixer.master): MixerChannel => ({
    ...c,
    busId: c.bus_id ?? undefined,
    automationBypassed: c.automation_bypassed,
    automation: c.automation?.map((l) => ({
      ...l,
      points: l.points.map((p) => ({ ...p, time: p.time * beat })),
    })),
  })
  const assets = d.sources.map((s) => renderSource(s, project.id, d.tempo))
  for (const c of d.tracks.flatMap((t) => t.clips))
    if (
      !c.source_id &&
      c.asset_id &&
      !assets.some((a) => a.id === `media-${c.asset_id}`)
    ) {
      assets.push({
        id: `media-${c.asset_id}`,
        name: c.name,
        kind: 'import',
        variant: 0,
        duration: c.offset + (c.source_duration ?? c.length_beats * beat),
        url: mediaUrl(project.id, c.asset_id),
      })
    }
  return {
    name: project.name,
    bpm: d.tempo,
    key: d.key ?? undefined,
    assets,
    parts: [],
    mixer: {
      master: channel(d.mixer.master),
      buses: d.mixer.buses.map(channel),
    },
    tracks: d.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      icon: 'layers',
      color: t.color ?? '#a1a1aa',
      gain: t.gain,
      mute: t.muted,
      solo: t.solo,
      effects: t.effects,
      busId: t.bus_id ?? undefined,
      clips: t.clips
        .filter((c) => c.source_id || c.asset_id)
        .map((c) =>
          renderClip(
            c,
            d.sources.find((s) => s.id === c.source_id),
            d.tempo,
          ),
        ),
    })),
  }
}
export const durationSeconds = (project: StoredProject) =>
  Math.max(
    1,
    ...renderProject(project).tracks.flatMap((t) =>
      t.clips.map((c) => c.start + c.duration),
    ),
  )
export function emptySource(
  kind: Source['kind'] = 'notes',
  sound: Source['sound'] = 'piano',
): Source {
  return {
    id: crypto.randomUUID(),
    name: kind === 'drums' ? 'Drums' : 'New Clip',
    kind,
    duration: 16,
    asset_id: null,
    notes: [],
    sound,
    drum_kit: 'studio',
    synth: {},
    sampler: null,
    drum_samples: [],
  }
}
