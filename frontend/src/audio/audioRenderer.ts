import { runAudioTask } from './audioTasks'
import type { AudioTask, AudioTaskReply, AudioTaskResult } from './audioTasks'

export type RenderWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>
type Job = {
  id: number
  task: AudioTask
  resolve: (value: AudioTaskResult) => void
  reject: (error: Error) => void
}
type Slot = { worker: RenderWorker; job?: Job }

// Two render lanes leave CPU available for the audio device and the interface.
// Copies are made only when a lane starts, so queued jobs don't duplicate PCM.
export class AudioRenderer {
  private slots: Slot[] = []
  private queue: Job[] = []
  private nextId = 0
  private epoch = 0
  private fallback = false
  private factory: (() => RenderWorker) | null
  private concurrency: number
  constructor(
    factory: (() => RenderWorker) | null = typeof Worker === 'undefined'
      ? null
      : () =>
          new Worker(new URL('./audio.worker.ts', import.meta.url), {
            type: 'module',
          }),
    concurrency = 2,
  ) {
    this.factory = factory
    this.concurrency = concurrency
  }

  run(task: AudioTask): Promise<AudioTaskResult> {
    if (!this.factory || this.fallback) {
      const epoch = this.epoch
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          if (epoch !== this.epoch) {
            reject(new DOMException('音频任务已取消', 'AbortError'))
            return
          }
          try {
            resolve(runAudioTask(task))
          } catch (error) {
            reject(error)
          }
        }, 0),
      )
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, task, resolve, reject })
      this.pump()
    })
  }
  reset() {
    this.epoch++
    const error = new DOMException('音频任务已取消', 'AbortError')
    for (const slot of this.slots) {
      slot.worker.terminate()
      slot.job?.reject(error)
      slot.job = undefined
    }
    for (const job of this.queue) job.reject(error)
    this.slots = []
    this.queue = []
  }
  private pump() {
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.job)
      if (!slot) {
        if (this.slots.length >= this.concurrency) return
        let worker: RenderWorker
        try {
          worker = this.factory!()
        } catch {
          this.fallback = true
          const queued = this.queue.splice(0)
          for (const job of queued)
            this.run(job.task).then(job.resolve, job.reject)
          return
        }
        slot = { worker }
        this.slots.push(slot)
        const lane = slot
        worker.onmessage = ({ data }: MessageEvent<AudioTaskReply>) => {
          const job = lane.job
          if (!job || data.id !== job.id) return
          lane.job = undefined
          if (data.result) job.resolve(data.result)
          else job.reject(new Error(data.error ?? '音频计算失败'))
          this.pump()
        }
        const fail = () => {
          lane.job?.reject(new Error('音频 Worker 中断，请重试'))
          lane.job = undefined
          worker.terminate()
          this.slots = this.slots.filter((s) => s !== lane)
          this.pump()
        }
        worker.onerror = fail
        worker.onmessageerror = fail
      }
      const job = this.queue.shift()!
      slot.job = job
      try {
        const transfer: Transferable[] = []
        let task = job.task
        if (task.kind === 'synth' && task.source) {
          const copy = (
            source: import('./voices').SamplePCM,
          ): import('./voices').SamplePCM => {
            const data = source.data.slice(),
              right = source.right?.slice()
            transfer.push(data.buffer)
            if (right) transfer.push(right.buffer)
            const drums = source.drums
              ? Object.fromEntries(
                  Object.entries(source.drums).map(([pitch, sample]) => [
                    pitch,
                    copy(sample),
                  ]),
                )
              : undefined
            return { ...source, data, right, drums }
          }
          task = { ...task, source: copy(task.source) }
        } else if (task.kind === 'wav') {
          const channels = task.channels.map((channel) => channel.slice())
          task = { ...task, channels }
          transfer.push(...channels.map((channel) => channel.buffer))
        }
        slot.worker.postMessage({ id: job.id, task }, transfer)
      } catch (error) {
        slot.job = undefined
        job.reject(
          error instanceof Error ? error : new Error('音频任务发送失败'),
        )
      }
    }
  }
}
