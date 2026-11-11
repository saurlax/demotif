import type { Sound, DrumKit } from './soundDefinitions'
export const BPM = 120
export const MIN_BPM = 20
export const MAX_BPM = 300
export const barLength = (bpm = BPM) => 240 / bpm
export const BAR = barLength()
export type Instrument = 'drums' | 'bass' | 'keys' | 'pad' | 'import'
export interface Note {
  id: string
  pitch: number
  start: number
  duration: number
  velocity: number
  sample?: {offset:number;duration:number;rootNote:number}
}
export interface DrumSample {
  pitch: number
  name: string
  url: string
  gain?: number
}
export interface Asset {
  phrases?: { url: string; offset: number }[]
  drumSamples?: DrumSample[]
  id: string
  name: string
  kind: Instrument
  variant: number
  duration: number
  notes?: Note[]
  bpm?: number
  sound?: Sound
  drumKit?: DrumKit
  synth?: SynthSettings
  sampler?: {
    rootNote: number
    loopStart?: number
    loopEnd?: number
    oneShot?: boolean
  }
  builtin_id?: string
  sampleRoot?: number
  sampleSource?: unknown
  url?: string
  peaks?: number[]
}
export interface OscillatorSettings {
  wave: 'saw' | 'sine' | 'square' | 'triangle'
  level: number
  transpose: number
  voices: number
  detune: number
  spread: number
  pan?: number
  bypassFilter?: boolean
}
export interface SynthSettings {
  oscillators?: OscillatorSettings[] | null
  resonance?: number
  filterDrive?: number
  keytrack?: number
  attack?: number
  decay?: number
  sustain?: number
  release?: number
  cutoff?: number
  detune?: number
}
export interface Clip {
  id: string
  assetId: string
  start: number
  offset: number
  duration: number
  name?: string
  gain?: number
  fadeIn?: number
  fadeOut?: number
  envelopeOffset?: number
  envelopeDuration?: number
}
export type TrackIcon =
  'layers' | 'keys' | 'drums' | 'bass' | 'pad' | 'import' | 'headphones'
export interface SavedPart {
  id: string
  name: string
  assetId: string
  offset: number
  duration: number
  color: string
}
export interface TrackEffects {
  softClip?: number
  width?: number
  air?: number
  multiband?: number
  threshold?: number
  ratio?: number
  compAttack?: number
  compRelease?: number
  highpass?: number
  lowpass?: number
  drive?: number
  reverb?: number
  delay?: number
  sidechain?: number
  pan?: number
  compressor?: boolean
  chorus?: number
  phaser?: number
  tremolo?: number
  autopan?: number
  bitcrusher?: number
  lowShelf?: number
  highShelf?: number
}
export interface SongSection {
  id: string
  name: string
  start: number
  duration: number
  color: string
}
export interface AutomationLane {
  parameter: 'gain' | 'lowpass' | 'highpass' | 'lowShelf' | 'highShelf'
  points: { time: number; value: number }[]
}
export interface MixerChannel {
  id: string
  name: string
  gain: number
  effects?: TrackEffects
  busId?: string
  automation?: AutomationLane[]
  automationBypassed?: boolean
}
export interface Track {
  busId?: string
  id: string
  name: string
  icon: TrackIcon
  color: string
  gain: number
  mute: boolean
  solo: boolean
  clips: Clip[]
  effects?: TrackEffects
}
export interface Project {
  mixer?: { master: MixerChannel; buses: MixerChannel[] }
  bpm: number
  name: string
  key?: string
  sections?: SongSection[]
  tracks: Track[]
  assets: Asset[]
  parts: SavedPart[]
}

export function audibleTracks(tracks: Track[]): Track[] {
  const solo = tracks.some((t) => t.solo)
  return tracks.filter((t) => !t.mute && (!solo || t.solo))
}
