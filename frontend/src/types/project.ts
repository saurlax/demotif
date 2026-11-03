import type {
  TrackEffects,
  SynthSettings,
  Sound,
  DrumKit,
  MixerChannel as RenderChannel,
} from '@/audio/contracts'
export type TrackKind = 'vocal' | 'instrument' | 'drums' | 'audio' | 'midi'
export type ClipKind = 'audio' | 'midi' | 'generated'

export interface Clip {
  id: string
  name: string
  kind: ClipKind
  start_beat: number
  length_beats: number
  asset_id: string | null
  source_id: string | null
  offset: number
  source_duration: number | null
  gain: number
  fade_in: number
  fade_out: number
  envelope_offset: number
  envelope_duration: number | null
  locked: boolean
  color: string | null
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  color: string | null
  muted: boolean
  solo: boolean
  locked: boolean
  gain: number
  bus_id: string | null
  effects: TrackEffects
  clips: Clip[]
}

export interface ProjectDocument {
  tempo: number
  time_signature: string
  key: string | null
  sources: Source[]
  parts: Part[]
  mixer: Mixer
  sections: {
    id: string
    name: string
    start: number
    duration: number
    color: string
  }[]
  tracks: Track[]
}

export interface Project {
  id: string
  name: string
  version: number
  can_undo: boolean
  is_draft: boolean
  draft_base_id: string | null
  draft_base_version: number | null
  draft_example_id: string | null
  has_unsaved_changes: boolean
  document: ProjectDocument
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  version: number
  created_at: string
  updated_at: string
}

export interface RevisionSummary {
  project_id: string
  version: number
  summary: string
  created_at: string
}

export type ProducerCommand =
  | { type: 'project.rename'; name: string }
  | { type: 'project.set_tempo'; tempo: number }
  | { type: 'project.set_time_signature'; time_signature: string }
  | {
      type: 'track.add'
      id?: string
      name: string
      kind: TrackKind
      color?: string | null
    }
  | { type: 'track.remove'; track_id: string }
  | { type: 'track.set_lock'; track_id: string; locked: boolean }
  | {
      type: 'clip.add'
      id?: string
      source_id?: string
      offset?: number
      source_duration?: number
      track_id: string
      name: string
      kind: ClipKind
      start_beat: number
      length_beats: number
      asset_id?: string | null
    }
  | { type: 'clip.move'; track_id: string; clip_id: string; start_beat: number }
  | { type: 'clip.remove'; track_id: string; clip_id: string }
  | { type: 'source.add'; source: Source }
  | ({ type: 'source.update'; source_id: string } & Partial<
      Pick<
        Source,
        | 'name'
        | 'notes'
        | 'duration'
        | 'sound'
        | 'drum_kit'
        | 'synth'
        | 'sampler'
        | 'drum_samples'
      >
    >)
  | { type: 'part.add'; part: Part }
  | { type: 'part.remove'; part_id: string }
  | ({ type: 'track.update'; track_id: string } & Partial<
      Pick<
        Track,
        'name' | 'muted' | 'solo' | 'gain' | 'bus_id' | 'effects' | 'color'
      >
    >)
  | ({
      type: 'clip.update'
      track_id: string
      clip_id: string
      target_track_id?: string
    } & Partial<
      Pick<
        Clip,
        | 'name'
        | 'start_beat'
        | 'length_beats'
        | 'offset'
        | 'source_duration'
        | 'source_id'
        | 'gain'
        | 'fade_in'
        | 'fade_out'
        | 'envelope_offset'
        | 'envelope_duration'
      >
    >)
  | { type: 'clip.split'; track_id: string; clip_id: string; at_beat: number }
  | { type: 'mixer.set'; mixer: Mixer }
  | { type: 'project.set_sections'; sections: ProjectDocument['sections'] }

export interface Note {
  id: string
  pitch: number
  start: number
  duration: number
  velocity: number
}
export interface Source {
  id: string
  name: string
  kind: 'notes' | 'drums' | 'audio'
  duration: number
  asset_id: string | null
  notes: Note[]
  sound: Sound
  drum_kit: DrumKit
  synth: SynthSettings
  sampler: {
    rootNote: number
    loopStart?: number
    loopEnd?: number
    oneShot?: boolean
  } | null
  drum_samples: {
    pitch: number
    name: string
    asset_id: string
    gain: number
  }[]
}
export interface Part {
  id: string
  name: string
  source_id: string
  offset: number
  duration: number
}
export interface Channel {
  id: string
  name: string
  gain: number
  effects: TrackEffects
  bus_id: string | null
  automation: RenderChannel['automation']
  automation_bypassed: boolean
}
export interface Mixer {
  master: Channel
  buses: Channel[]
}
export interface MediaAsset {
  id: string
  filename: string
  content_type: string
  size_bytes: number
}

export interface CommandResult {
  project: Project
  revision: RevisionSummary
  applied: ProducerCommand
}

export interface AgentReply {
  reply: string
  commands: ProducerCommand[]
}
