import type { z } from 'zod'
import type { clipSchema, trackSchema, documentSchema, commandSchema, noteSchema, sourceSchema, partSchema, channelSchema, mixerSchema } from '@/shared/schema'
export type TrackKind = 'vocal' | 'instrument' | 'drums' | 'audio' | 'midi'
export type ClipKind = 'audio' | 'midi' | 'generated'

export type Clip = z.infer<typeof clipSchema>
export type Track = z.infer<typeof trackSchema>
export type ProjectDocument = z.infer<typeof documentSchema>

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

export type ProducerCommand = z.input<typeof commandSchema>
export type Note = z.infer<typeof noteSchema>
export type Source = z.infer<typeof sourceSchema>
export type Part = z.infer<typeof partSchema>
export type Channel = z.infer<typeof channelSchema>
export type Mixer = z.infer<typeof mixerSchema>

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
