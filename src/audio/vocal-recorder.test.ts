import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { VocalRecorder, assembleCapture } from './vocal-recorder'
import { encodeWavBytes } from './pcm'

it('gates actual worklet PCM by frames, emits silence and acknowledges the last frame', () => {
  const messages: Record<string, unknown>[] = []
  let processor: new () => { port: { onmessage: (e: { data: unknown }) => void }; process: (input: Float32Array[][], output: Float32Array[][]) => boolean }
  const scope = vm.createContext({ Float32Array, Math, currentFrame: 0,
    AudioWorkletProcessor: class { port = { postMessage: (m: Record<string, unknown>) => messages.push(m) } },
    registerProcessor: (_: string, c: typeof processor) => { processor = c } })
  vm.runInContext(readFileSync('public/audio/recording-worklet.js', 'utf8').replace('export function', 'function'), scope)
  const p = new processor!(), output = new Float32Array(128)
  p.port.onmessage({ data: { type: 'arm', start: 30, end: 210 } })
  p.process([[new Float32Array(128).fill(.25)]], [[output]])
  scope.currentFrame = 128
  p.process([[new Float32Array(128).fill(.25)]], [[output]])
  const blocks = messages.filter((m) => m.type === 'pcm') as unknown as { frame: number; pcm: Float32Array }[]
  expect(blocks.map((b) => b.pcm.length)).toEqual([98, 82])
  expect(messages.at(-1)).toEqual({ type: 'done', frame: 210 })
  expect(assembleCapture(blocks, 30, 210)).toEqual(new Float32Array(180).fill(.25))
  expect(output.every((s) => s === 0)).toBe(true)
  const bytes = encodeWavBytes([new Float32Array([-1, 1])], 48000), wav = new DataView(bytes.buffer)
  expect(wav.getUint32(24, true)).toBe(48000)
  expect(wav.getInt16(44, true)).toBe(-32768)
  expect(wav.getInt16(46, true)).toBe(32767)
})

afterEach(() => vi.unstubAllGlobals())
function harness(getUserMedia = vi.fn()) {
  const events = { phase: vi.fn(), progress: vi.fn(), level: vi.fn(), take: vi.fn(), error: vi.fn() }
  const stop = vi.fn(), track = { stop, onended: null }, stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  if (!getUserMedia.getMockImplementation()) getUserMedia.mockResolvedValue(stream)
  const port = { postMessage: vi.fn(), onmessage: null as null | ((e: { data: unknown }) => void), close: vi.fn() }
  const context = { currentTime: 2, sampleRate: 1000, state: 'running', onstatechange: null,
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }) }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', class { constructor() { return context } })
  vi.stubGlobal('AudioWorkletNode', class { port = port; connect = vi.fn(); disconnect = vi.fn() })
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return { recorder: new VocalRecorder(events), events, stop, stream, context, port }
}
it('releases a permission grant after cancellation and does not revive the session', async () => {
  let grant!: (v: unknown) => void
  const h = harness(vi.fn(() => new Promise((resolve) => { grant = resolve })))
  const pending = h.recorder.prepare(); h.recorder.dispose(); grant(h.stream); await pending
  expect(h.stop).toHaveBeenCalledOnce(); expect(h.events.phase).not.toHaveBeenCalledWith('ready')
})
it('captures from the count-in boundary, retains exact frames and releases resources', async () => {
  const h = harness(); await h.recorder.prepare(); h.recorder.record(120, '6/8', 2, false)
  const arm = h.port.postMessage.mock.calls[0][0]
  expect(arm).toEqual({ type: 'arm', start: 3600, end: 5850 })
  h.port.onmessage!({ data: { type: 'pcm', frame: 3600, pcm: new Float32Array(100).fill(.2) } })
  h.port.onmessage!({ data: { type: 'done', frame: 3700 } })
  expect(h.events.take.mock.calls[0][0]).toMatchObject({ sampleRate: 1000, duration: .1, interrupted: false })
  expect(h.stop).toHaveBeenCalledOnce(); expect(h.context.close).toHaveBeenCalledOnce()
})
it('handles rejection and zero-frame cancellation without creating a replacement take', async () => {
  const denied = harness(vi.fn().mockRejectedValue(new Error('Permission denied')))
  await denied.recorder.prepare(); expect(denied.events.error).toHaveBeenCalledOnce()
  const h = harness(); await h.recorder.prepare(); h.recorder.record(120, '4/4', 4, false)
  h.recorder.stop(true); expect(h.events.take).not.toHaveBeenCalled(); expect(h.stop).toHaveBeenCalledOnce()
})
it('retains already received audio as interrupted after processor/device failure', async () => {
  const h = harness(); await h.recorder.prepare(); h.recorder.record(120, '4/4', 4, false)
  h.context.currentTime = 5
  h.port.onmessage!({ data: { type: 'pcm', frame: 4100, pcm: new Float32Array(100).fill(.1) } })
  h.recorder.stop(true)
  expect(h.events.take.mock.calls[0][0]).toMatchObject({ duration: .1, interrupted: true })
})

it('does not replace a take when a processor finishes without receiving any audio frames', async () => {
  const h = harness(); await h.recorder.prepare(); h.recorder.record(120, '4/4', 4, false)
  h.port.onmessage!({ data: { type: 'done', frame: 8350 } })
  expect(h.events.take).not.toHaveBeenCalled(); expect(h.stop).toHaveBeenCalledOnce()
})
