import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioRenderer } from './audioRenderer'
import type { RenderWorker } from './audioRenderer'
import { runAudioTask } from './audioTasks'
import type { AudioTask, AudioTaskReply } from './audioTasks'
import type { Asset } from './model'

const asset: Asset = {
  id: 'part',
  name: 'part',
  kind: 'keys',
  variant: 0,
  duration: 0.1,
  sampler: { rootNote: 60, oneShot: true },
  notes: [{ id: 'n', start: 0, duration: 0.02, pitch: 60, velocity: 0.8 }],
}
class FakeWorker implements RenderWorker {
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  onmessageerror: Worker['onmessageerror'] = null
  sent: { id: number; task: AudioTask }[] = []
  transfer: Transferable[][] = []
  terminate = vi.fn()
  postMessage(
    message: { id: number; task: AudioTask },
    transfer: Transferable[] | StructuredSerializeOptions = [],
  ) {
    this.sent.push(message)
    this.transfer.push(
      Array.isArray(transfer) ? transfer : (transfer.transfer ?? []),
    )
  }
  finish(index = 0) {
    const { id, task } = this.sent[index]
    this.reply({ id, result: runAudioTask(task) })
  }
  reply(data: AudioTaskReply) {
    this.onmessage?.call(
      this as unknown as Worker,
      new MessageEvent('message', { data }),
    )
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('background audio rendering', () => {
  it('bounds parallel renders, transfers private PCM copies and preserves exactly the same samples', async () => {
    const workers: FakeWorker[] = []
    const pool = new AudioRenderer(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    const source = {
      data: Float32Array.from(
        { length: 2205 },
        (_, i) => Math.sin(i * 0.1) * 0.4,
      ),
      rate: 22050,
    }
    const task: AudioTask = { kind: 'synth', asset, source }
    const jobs = [pool.run(task), pool.run(task), pool.run(task)]
    expect(workers).toHaveLength(2)
    const sent = workers[0].sent[0].task
    expect(sent.kind === 'synth' && sent.source!.data.buffer).not.toBe(
      source.data.buffer,
    )
    expect(source.data.byteLength).toBe(8820)
    expect(workers[0].transfer[0]).toHaveLength(1)
    workers[0].finish()
    expect(workers[0].sent).toHaveLength(2)
    workers[1].finish()
    workers[0].finish(1)
    for (const result of await Promise.all(jobs))
      expect(result).toEqual(runAudioTask(task))
    pool.reset()
    expect(workers.every((w) => w.terminate.mock.calls.length === 1)).toBe(true)
  })
  it('rejects queued/running jobs on release and does not accept late worker replies', async () => {
    const workers: FakeWorker[] = []
    const pool = new AudioRenderer(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    const task: AudioTask = {
      kind: 'synth',
      asset: { ...asset, sampler: undefined },
    }
    const old = Promise.allSettled([
      pool.run(task),
      pool.run(task),
      pool.run(task),
    ])
    pool.reset()
    expect(
      (await old).every(
        (r) => r.status === 'rejected' && r.reason.name === 'AbortError',
      ),
    ).toBe(true)
    const current = pool.run(task)
    workers[0].finish()
    expect(workers).toHaveLength(3)
    workers[2].finish()
    expect(await current).toEqual(runAudioTask(task))
    pool.reset()
  })
  it('encodes interleaved WAV off-thread without detaching playback channel data', async () => {
    const worker = new FakeWorker(),
      pool = new AudioRenderer(() => worker)
    const channels = [
      new Float32Array([0, 1, -1]),
      new Float32Array([0.5, -0.5, 0]),
    ]
    const pending = pool.run({ kind: 'wav', channels, rate: 44100 })
    expect(worker.transfer[0]).toHaveLength(2)
    worker.finish()
    const result = await pending
    expect('wav' in result).toBe(true)
    if (!('wav' in result)) return
    const view = new DataView(result.wav.buffer)
    expect(view.getUint32(40, true)).toBe(12)
    expect([44, 46, 48, 50, 52, 54].map((i) => view.getInt16(i, true))).toEqual(
      [0, 16383, 32767, -16384, -32768, 0],
    )
    expect(channels[0].byteLength).toBe(12)
    pool.reset()
  })
  it('reports a failed lane while allowing subsequent work to run', async () => {
    const workers: FakeWorker[] = []
    const pool = new AudioRenderer(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    }, 1)
    const task: AudioTask = {
      kind: 'wav',
      channels: [new Float32Array([0])],
      rate: 44100,
    }
    const failed = expect(pool.run(task)).rejects.toThrow('Worker')
    const next = pool.run(task)
    workers[0].onerror?.call(
      workers[0] as unknown as Worker,
      new ErrorEvent('error'),
    )
    await failed
    workers[1].finish()
    expect(await next).toEqual(runAudioTask(task))
    pool.reset()
  })
  it('yields in a worker-less environment and cancels fallback work when released', async () => {
    const pool = new AudioRenderer(null)
    const task: AudioTask = {
      kind: 'wav',
      channels: [new Float32Array([0.25])],
      rate: 22050,
    }
    expect(await pool.run(task)).toEqual(runAudioTask(task))
    const canceled = expect(pool.run(task)).rejects.toMatchObject({
      name: 'AbortError',
    })
    pool.reset()
    await canceled
  })
})
