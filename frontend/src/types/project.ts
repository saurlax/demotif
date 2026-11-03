export type TrackKind = 'vocal' | 'instrument' | 'drums' | 'audio' | 'midi'
export type ClipKind = 'audio' | 'midi' | 'generated'

export interface Clip {
  id: string
  name: string
  kind: ClipKind
  start_beat: number
  length_beats: number
  asset_id: string | null
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
  clips: Clip[]
}

export interface ProjectDocument {
  tempo: number
  time_signature: string
  key: string | null
  tracks: Track[]
}

export interface Project {
  id: string
  name: string
  version: number
  can_undo: boolean
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
  | { type: 'track.add'; name: string; kind: TrackKind; color?: string | null }
  | { type: 'track.remove'; track_id: string }
  | { type: 'track.set_lock'; track_id: string; locked: boolean }
  | {
      type: 'clip.add'
      track_id: string
      name: string
      kind: ClipKind
      start_beat: number
      length_beats: number
      asset_id?: string | null
    }
  | { type: 'clip.move'; track_id: string; clip_id: string; start_beat: number }
  | { type: 'clip.remove'; track_id: string; clip_id: string }

export interface CommandResult {
  project: Project
  revision: RevisionSummary
  applied: ProducerCommand
}

export interface AgentReply {
  reply: string
  commands: ProducerCommand[]
}
