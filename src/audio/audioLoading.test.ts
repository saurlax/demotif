import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audio'
import type { Asset } from './model'

afterEach(() => vi.unstubAllGlobals())

const asset = (id: string): Asset => ({
  id,
  name: id,
  kind: 'import',
  variant: 0,
  duration: 1,
  url: `/api/media/${id}`,
})

describe('recorded song loading', () => {
  it('bounds simultaneous fetch/decode work for a multitrack song', async () => {
    let active = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        active++
        peak = Math.max(peak, active)
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }
      }),
    )
    vi.stubGlobal(
      'AudioContext',
      class {
        async decodeAudioData() {
          await Promise.resolve()
          active--
          return {} as AudioBuffer
        }
      },
    )
    const engine = new AudioEngine()
    const assets = Array.from({ length: 17 }, (_, i) => asset(String(i)))
    await engine.prepare(assets)
    expect(peak).toBe(3)
    expect(active).toBe(0)
    expect(assets.every((a) => engine.hasBuffer(a.id))).toBe(true)
    await engine.prepare(assets)
    expect(fetch).toHaveBeenCalledTimes(17)
    engine.release()
    expect(assets.some((a) => engine.hasBuffer(a.id))).toBe(false)
  })

  it('discards late results and stops the old queue when switching projects', async () => {
    const decodes: ((buffer: AudioBuffer) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      })),
    )
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData() {
          return new Promise<AudioBuffer>((resolve) => decodes.push(resolve))
        }
      },
    )
    const engine = new AudioEngine()
    const old = engine.prepare(
      Array.from({ length: 9 }, (_, i) => asset(String(i))),
    )
    await vi.waitFor(() => expect(decodes).toHaveLength(3))
    engine.release()
    const current = engine.prepare([asset('0')])
    await vi.waitFor(() => expect(decodes).toHaveLength(4))
    for (const resolve of decodes.slice(0, 3)) resolve({} as AudioBuffer)
    await old
    expect(engine.hasBuffer('0')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(4)
    decodes[3]({} as AudioBuffer)
    await current
    expect(engine.hasBuffer('0')).toBe(true)
  })
  it('decodes identical media only once across many shared sampler Parts', async () => {
    const buffer = {} as AudioBuffer
    const decode = vi.fn(async () => buffer)
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = decode
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      })),
    )
    const engine = new AudioEngine()
    const parts = Array.from({ length: 24 }, (_, i) => ({
      ...asset(String(i)),
      url: '/api/media/shared',
    }))
    await engine.prepare(parts)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(parts.every((a) => engine.hasBuffer(a.id))).toBe(true)
    await engine.prepare([
      { ...asset('another-pattern'), url: '/api/media/shared' },
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    engine.release()
    await engine.prepare(parts.slice(0, 1))
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

it('deduplicates shared multi-sample drum rows across Part variants', async () => {
  const decode = vi.fn(async () => ({
    getChannelData: () => new Float32Array(1000),
    sampleRate: 22050,
    numberOfChannels: 1,
  }))
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = decode
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1),
    })),
  )
  const engine = new AudioEngine()
  const kit: Asset = {
    ...asset('kit'),
    kind: 'drums',
    url: undefined,
    drumSamples: [
      { pitch: 36, name: 'A', url: '/api/media/shared' },
      { pitch: 38, name: 'B', url: '/api/media/other' },
    ],
  }
  await engine.prepare([kit, { ...kit, id: 'kit-variant' }])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(decode).toHaveBeenCalledTimes(2)
  await engine.prepare([
    {
      ...kit,
      drumSamples: kit.drumSamples!.map((r, i) =>
        i === 0 ? { ...r, url: '/api/media/replacement' } : r,
      ),
    },
  ])
  expect(decode).toHaveBeenCalledTimes(3)
  engine.release()
})
