import { ModalClient, TimeoutError } from 'modal'
import { z } from 'zod'
import { config } from '../config'
import { ApiError } from '../errors'

type Excerpt = { offset: number; duration: number }
type Transcription = Excerpt & { mode: 'pitched' | 'percussion'; min_pitch: number; max_pitch: number; drum_pitch: number }
const bytes = z.instanceof(Uint8Array).transform((value) => Buffer.from(value))
const duration = z.number().positive()
const output = {
  excerpt: z.object({ audio: bytes }),
  normalize: z.object({ audio: bytes, duration }),
  voice_wav: z.object({ audio: bytes }),
  probe: z.object({ duration }),
  transcribe: z.object({
    duration, version: z.string(), confidence: z.number(), coverage: z.number(),
    notes: z.array(z.object({ pitch: z.number().int().min(0).max(127), start: z.number().nonnegative(),
      duration, velocity: z.number().min(0).max(1) })),
  }),
}

export async function processModalAudio<K extends keyof typeof output>(
  operation: K, input: Uint8Array, params: K extends 'transcribe' ? Transcription : K extends 'excerpt' ? Excerpt : Record<string, never>,
  signal: AbortSignal,
): Promise<z.output<(typeof output)[K]>> {
  signal.throwIfAborted()
  const { app, environment } = config.mediaModal
  if (!app) throw new ApiError(503, 'media_unavailable', 'Configure the Modal media worker before processing audio.')
  const worker = await new ModalClient().functions.fromName(app, 'process', { environment })
  signal.throwIfAborted()
  const call = await worker.spawn([operation, input, params])
  let abort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    const result: unknown = await Promise.race([call.get({ timeoutMs: 240_000 }), cancelled])
    signal.throwIfAborted()
    return output[operation].parse(result) as z.output<(typeof output)[K]>
  } catch (error) {
    if (signal.aborted || error instanceof TimeoutError) void call.cancel().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
