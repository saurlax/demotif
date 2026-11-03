import type { Asset } from './model'
import { renderVoice } from './voices'
import type { SamplePCM } from './voices'
import { encodeWavBytes } from './pcm'

export type AudioTask =
  | { kind: 'synth'; asset: Asset; source?: SamplePCM }
  | { kind: 'wav'; channels: Float32Array[]; rate: number }
export type AudioTaskResult =
  | { pcm: Float32Array<ArrayBuffer>; right?: Float32Array<ArrayBuffer> }
  | { wav: Uint8Array<ArrayBuffer> }
export type AudioTaskReply = {
  id: number
  result?: AudioTaskResult
  error?: string
}

// The Worker and the fallback execute identical DSP/encoding code.
export function runAudioTask(task: AudioTask): AudioTaskResult {
  return task.kind === 'synth'
    ? renderVoice(task.asset, task.source)
    : { wav: encodeWavBytes(task.channels, task.rate) }
}
