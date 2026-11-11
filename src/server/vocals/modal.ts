import { ModalClient, TimeoutError } from 'modal'
import type { Source } from '@/types/project'

export type ModalVoiceTarget = { app: string; environment: string; voiceId: string; engine?: 'nnsvs' }

export async function renderModalVocal(target: ModalVoiceTarget, source: Source, tempo: number, signal: AbortSignal, sourceContext?: Source) {
  signal.throwIfAborted()
  const client = new ModalClient()
  const worker = await client.cls.fromName(target.app, 'Singing', { environment: target.environment })
  const instance = await worker.instance()
  signal.throwIfAborted()
  const args = target.engine === 'nnsvs'
    ? [target.voiceId, { source, tempo, source_context: sourceContext ?? source }]
    : [target.voiceId, source, tempo]
  const call = await instance.method('render').spawn(args)
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    const result: unknown = await Promise.race([call.get({ timeoutMs: 300_000 }), cancelled])
    signal.throwIfAborted()
    return result
  } catch (error) {
    if (signal.aborted || error instanceof TimeoutError) void call.cancel().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
