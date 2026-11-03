import { describe, expect, it } from 'vitest'
import { clipEnvelope, createTrackBus, duckLevel } from './effects'

// Inspect the actual control waveform used by Web Audio, including its seek phase.
function context() {
  let coefficients: { real: Float32Array; imag: Float32Array } | undefined
  const waves: { real: Float32Array; imag: Float32Array }[] = []
  const nodes: {
    type: string
    stopped: boolean
    disconnected: boolean
    gain: { value: number }
    frequency: { value: number }
    delayTime: { value: number }
  }[] = []
  const parameter = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  })
  const node = (type: string) => {
    const value = {
      type,
      stopped: false,
      disconnected: false,
      gain: parameter(),
      frequency: parameter(),
      delayTime: { value: 0 },
      pan: { value: 0 },
      Q: { value: 0 },
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
      connect() {},
      disconnect() {
        value.disconnected = true
      },
      start() {},
      stop() {
        value.stopped = true
      },
      setPeriodicWave() {},
    }
    nodes.push(value)
    return value
  }
  const ctx = {
    sampleRate: 44100,
    createDynamicsCompressor: () => node('compressor'),
    createChannelSplitter: () => node('splitter'),
    createChannelMerger: () => node('merger'),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length)
      return { getChannelData: () => data }
    },
    createBufferSource: () => node('source'),
    createGain: () => node('gain'),
    createDelay: () => node('delay'),
    createBiquadFilter: () => node('filter'),
    createOscillator: () => node('oscillator'),
    createWaveShaper: () => node('shaper'),
    createStereoPanner: () => node('panner'),
    createPeriodicWave: (real: Float32Array, imag: Float32Array) => {
      coefficients = { real, imag }
      waves.push(coefficients)
      return {}
    },
  }
  return {
    ctx: ctx as unknown as BaseAudioContext,
    nodes,
    waves,
    get coefficients() {
      return coefficients!
    },
  }
}

describe('musical effects', () => {
  it('keeps the sidechain waveform on the kick grid for playback, seeks, tempo changes and repeated Part playback', () => {
    for (const bpm of [80, 128, 160])
      for (const from of [0, 0.173, 61.25]) {
        const test = context()
        const bus = createTrackBus(
          test.ctx,
          {} as AudioNode,
          0.5,
          { sidechain: 0.72 },
          bpm,
          from,
          10,
        )
        const lfo = test.nodes.find((node) => node.type === 'oscillator')!
        expect(lfo.frequency.value).toBe(bpm / 60)
        const { real, imag } = test.coefficients
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.9, 1, 8.5]) {
          const phase = 2 * Math.PI * fraction
          let value = 1 - (0.72 * 5) / 16
          for (let n = 1; n < 4; n++)
            value +=
              real[n] * Math.cos(n * phase) + imag[n] * Math.sin(n * phase)
          expect(value).toBeCloseTo(
            duckLevel(from + (fraction * 60) / bpm, bpm, 0.72),
            6,
          )
        }
        bus.dispose()
        expect(lfo.stopped).toBe(true)
        expect(test.nodes.every((node) => node.disconnected)).toBe(true)
      }
  })
  it('uses dotted eighth-note delay and removes the feedback graph when stopped', () => {
    const test = context()
    const bus = createTrackBus(
      test.ctx,
      {} as AudioNode,
      0.65,
      { delay: 0.2 },
      128,
    )
    expect(
      test.nodes.find((node) => node.type === 'delay')!.delayTime.value,
    ).toBe((60 / 128) * 0.75)
    bus.dispose()
    expect(test.nodes.every((node) => node.disconnected)).toBe(true)
  })
  it('builds every new effect and restarts modulation at the correct BPM and seek phase', () => {
    const test = context(),
      bpm = 120,
      from = 0.37
    const bus = createTrackBus(
      test.ctx,
      {} as AudioNode,
      0.5,
      {
        lowShelf: -3,
        highShelf: 4,
        bitcrusher: 0.5,
        chorus: 0.6,
        phaser: 0.4,
        tremolo: 0.5,
        autopan: 0.7,
      },
      bpm,
      from,
      3,
    )
    const oscillators = test.nodes.filter((n) => n.type === 'oscillator')
    expect(oscillators).toHaveLength(8)
    for (let i = 0; i < oscillators.length; i++) {
      const frequency = oscillators[i].frequency.value,
        phase = i === 4 ? -Math.PI / 2 : i === 5 ? Math.PI / 2 : 0
      const { real, imag } = test.waves[i]
      for (const t of [0, 0.1, 2])
        expect(
          real[1] * Math.cos(2 * Math.PI * frequency * t) +
            imag[1] * Math.sin(2 * Math.PI * frequency * t),
        ).toBeCloseTo(Math.sin(2 * Math.PI * frequency * (from + t) + phase), 6)
    }
    bus.dispose()
    expect(oscillators.every((n) => n.stopped)).toBe(true)
    expect(test.nodes.every((n) => n.disconnected)).toBe(true)
  })
  it('preserves fade levels when seeking into a clip instead of restarting its envelope', () => {
    expect(clipEnvelope(0, 15, 4, 4)).toBe(0)
    expect(clipEnvelope(2, 15, 4, 4)).toBe(0.5)
    expect(clipEnvelope(8, 15, 4, 4)).toBe(1)
    expect(clipEnvelope(13, 15, 4, 4)).toBe(0.5)
    expect(clipEnvelope(15, 15, 4, 4)).toBe(0)
    expect(clipEnvelope(2, 15)).toBe(1)
  })
})

it('builds the extended mixer processors and stops looping control buffers on dispose', () => {
  const test = context()
  const bus = createTrackBus(
    test.ctx,
    {} as AudioNode,
    0.7,
    {
      compressor: true,
      threshold: -18,
      ratio: 4,
      compAttack: 0.01,
      compRelease: 0.2,
      multiband: 0.4,
      width: 1.3,
      air: 0.2,
      softClip: 0.3,
    },
    132,
    2,
    5,
    [
      {
        parameter: 'gain',
        points: [
          { time: 0, value: 1 },
          { time: 4, value: 0.5 },
        ],
      },
    ],
    { start: 0, length: 4, phase: 2 },
  )
  const compressors = test.nodes.filter((n) => n.type === 'compressor')
  expect(compressors).toHaveLength(4)
  const source = test.nodes.find((n) => n.type === 'source')!
  expect(test.nodes.some((n) => n.type === 'splitter')).toBe(true)
  bus.dispose()
  expect(source.stopped).toBe(true)
  expect(test.nodes.every((n) => n.disconnected)).toBe(true)
})
