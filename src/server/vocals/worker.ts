import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { config, repositoryRoot } from '../config'

type Event = { protocol: number; id: string; event: string; stage?: string; seconds?: number; result?: unknown; error?: { message: string } }
type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; progress?: (stage: string) => void; cleanup: () => void }
export class NativeWorker {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private sequence = 0
  private profileFingerprint?: string
  private engine?: string
  private removeShutdownHandlers?: () => void
  constructor(privateOptions?: { executable: string; entry: string }) { this.options = privateOptions }
  private options?: { executable: string; entry: string }
  private start(engine: string) {
    if (this.child) return this.child
    const child = spawn(this.options?.executable ?? (engine === 'nnsvs' ? config.nnsvsPython : config.singingPython),
      [this.options?.entry ?? resolve(repositoryRoot, engine === 'nnsvs' ? 'workers/singing/nnsvs_worker.py' : 'workers/singing/worker.py')],
      { cwd: repositoryRoot, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    const shutdown = () => this.stop(new Error('Application is stopping'))
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    this.removeShutdownHandlers = () => {
      process.removeListener('SIGINT', shutdown)
      process.removeListener('SIGTERM', shutdown)
    }
    // Consume native diagnostic output without allowing it to block the model process.
    child.stderr.on('data', () => {})
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      let event: Event
      try { event = JSON.parse(line) as Event } catch { this.stop(new Error('Singing worker returned invalid JSON')); return }
      if (event.protocol !== 1 || typeof event.id !== 'string' || !['progress', 'loaded', 'complete', 'ready', 'stopped', 'error'].includes(event.event)) { this.stop(new Error('Invalid singing worker event')); return }
      const job = this.pending.get(event.id)
      if (!job) return
      if (event.event === 'progress' || event.event === 'loaded') {
        job.progress?.(event.stage ?? event.event)
      } else if (event.event === 'complete' || event.event === 'ready' || event.event === 'stopped') {
        this.pending.delete(event.id); job.cleanup(); job.resolve(event.result ?? { ready: true })
      } else if (event.event === 'error') {
        this.pending.delete(event.id); job.cleanup(); job.reject(new Error(event.error?.message ?? 'Singing inference failed'))
      }
    })
    const failed = (error: Error) => {
      if (this.child !== child) return
      this.child = undefined
      this.removeShutdownHandlers?.(); this.removeShutdownHandlers = undefined
      for (const job of this.pending.values()) { job.cleanup(); job.reject(error) }
      this.pending.clear()
      lines.close()
    }
    child.on('error', failed)
    child.on('exit', (code, signal) => {
      const error = new Error(`Singing worker stopped (${signal ?? code})`)
      error.name = 'WorkerExited'
      failed(error)
    })
    child.stdin.on('error', failed)
    return child
  }
  run<T>(input: Record<string, unknown>, signal?: AbortSignal, progress?: (stage: string) => void): Promise<T> {
    signal?.throwIfAborted()
    const signature = typeof input.profile_fingerprint === 'string' ? input.profile_fingerprint : undefined
    const engine = input.engine === 'nnsvs' ? 'nnsvs' : 'diffsinger'
    if (engine !== this.engine || (signature && signature !== this.profileFingerprint)) {
      this.stop()
      this.profileFingerprint = signature
      this.engine = engine
    }
    const child = this.start(engine)
    const id = String(++this.sequence)
    return new Promise<T>((resolveResult, reject) => {
      const abort = () => this.stop(new DOMException('Singing render cancelled', 'AbortError'))
      this.pending.set(id, { resolve: (value) => resolveResult(value as T), reject, progress,
        cleanup: () => signal?.removeEventListener('abort', abort) })
      signal?.addEventListener('abort', abort, { once: true })
      child.stdin.write(JSON.stringify({ ...input, protocol: 1, id }) + '\n')
    })
  }
  stop(reason = new Error('Singing worker closed')) {
    const child = this.child
    this.removeShutdownHandlers?.(); this.removeShutdownHandlers = undefined
    this.child = undefined
    child?.kill('SIGKILL')
    for (const job of this.pending.values()) { job.cleanup(); job.reject(reason) }
    this.pending.clear()
  }
}
