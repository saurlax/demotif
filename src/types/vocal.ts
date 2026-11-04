export interface VocalVoice {
  id: string
  name: string
  languages: string[]
  ready: boolean
  reason?: string
  usage: string
  controls: { pitch: boolean; vibrato: boolean; volume: boolean; automaticPitch: boolean; automaticTiming: boolean }
}
export interface VocalPhraseResult {
  asset_id: string
  sample_rate: number
  duration_seconds: number
  alignment: { offset_seconds: number; lead_seconds: number; tail_seconds: number; source_start_beat: number }
}
export interface VocalRenderStatus {
  id: string
  source_id: string
  fingerprint: string
  current: boolean
  status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'interrupted' | 'missing'
  stage?: string
  error?: string
  phrases: VocalPhraseResult[]
}
