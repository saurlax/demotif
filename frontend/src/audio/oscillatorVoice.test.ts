import { describe, expect, it } from 'vitest'
import { renderVoice, SYNTH_RATE } from './voices'
import { runAudioTask } from './audioTasks'
import type { Asset } from './model'
const asset: Asset = {
  id: 's',
  name: 'Reese',
  kind: 'bass',
  variant: 0,
  duration: 0.8,
  notes: [{ id: 'n', start: 0, duration: 0.5, pitch: 69, velocity: 0.8 }],
  synth: {
    attack: 0.0005,
    release: 0.1,
    cutoff: 4000,
    oscillators: [
      {
        wave: 'sine',
        level: 0.7,
        transpose: -24,
        voices: 1,
        detune: 0,
        spread: 0,
        bypassFilter: true,
      },
    ],
  },
}
const rms = (d: Float32Array) =>
  Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length)
function crossings(d: Float32Array) {
  let n = 0
  for (let i = 1; i < d.length; i++) if (d[i] >= 0 && d[i - 1] < 0) n++
  return n
}
describe('editable stereo oscillator patches', () => {
  it('keeps a -24 semitone centered sub at 110Hz with no side signal', () => {
    const { pcm, right } = renderVoice(asset)
    expect(right).toEqual(pcm)
    expect(
      Math.abs(crossings(pcm.slice(0, SYNTH_RATE * 0.4)) - 44),
    ).toBeLessThanOrEqual(1)
    expect(rms(pcm.slice(SYNTH_RATE * 0.65))).toBe(0)
  })
  it('gives unison real stereo width and deterministic, finite DSP in worker and direct rendering', () => {
    const patch: Asset = {
      ...asset,
      synth: {
        ...asset.synth,
        filterDrive: 6.7,
        resonance: 0.37,
        keytrack: 0.35,
        cutoff: 260,
        oscillators: [
          {
            wave: 'saw',
            level: 0.7,
            transpose: -24,
            voices: 8,
            detune: 29,
            spread: 1,
          },
        ],
      },
    }
    const result = renderVoice(patch)
    expect(result.right).toBeDefined()
    const side = result.pcm.map((v, i) => v - result.right![i])
    expect(rms(side)).toBeGreaterThan(0.01)
    expect(result.pcm.every(Number.isFinite)).toBe(true)
    expect(result.right!.every(Number.isFinite)).toBe(true)
    expect(runAudioTask({ kind: 'synth', asset: patch })).toEqual(result)
  })
  it('preserves both recorded sample channels rather than collapsing the source to mono', () => {
    const sampled: Asset = {
      ...asset,
      kind: 'drums',
      sampler: { rootNote: 36 },
      notes: [{ id: 'n', start: 0, duration: 0.1, pitch: 36, velocity: 1 }],
      synth: { attack: 0, release: 0, cutoff: 20000 },
    }
    const result = renderVoice(sampled, {
      data: new Float32Array(5000).fill(0.2),
      right: new Float32Array(5000).fill(-0.3),
      rate: SYNTH_RATE,
    })
    expect(result.pcm[100]).toBeCloseTo(0.2)
    expect(result.right![100]).toBeCloseTo(-0.3)
  })
})

it('mixes every drum row from its own sample with independent timing, gain and stereo', () => {
  const kit: Asset = {
    ...asset,
    kind: 'drums',
    duration: 0.4,
    synth: { attack: 0, release: 0, cutoff: 20000 },
    drumSamples: [
      { pitch: 36, name: 'BRP', url: '/api/media/a', gain: 1 },
      { pitch: 38, name: 'Jumpstyle', url: '/api/media/b', gain: 0.5 },
      { pitch: 42, name: 'Euphoria', url: '/api/media/c', gain: 0.8 },
    ],
    notes: [
      { id: 'a', pitch: 36, start: 0, duration: 0.1, velocity: 1 },
      { id: 'b', pitch: 38, start: 0.1, duration: 0.1, velocity: 1 },
      { id: 'c', pitch: 42, start: 0.2, duration: 0.1, velocity: 1 },
    ],
  }
  const sample = (value: number, right: number) => ({
    data: new Float32Array(5000).fill(value),
    right: new Float32Array(5000).fill(right),
    rate: SYNTH_RATE,
  })
  const result = renderVoice(kit, {
    data: new Float32Array(0),
    rate: SYNTH_RATE,
    drums: {
      36: sample(0.2, 0.1),
      38: sample(0.4, -0.2),
      42: sample(0.5, 0.3),
    },
  })
  for (const [time, left, right] of [
    [0.05, 0.2, 0.1],
    [0.15, 0.2, -0.1],
    [0.25, 0.4, 0.24],
    [0.35, 0, 0],
  ]) {
    expect(result.pcm[Math.floor(time * SYNTH_RATE)]).toBeCloseTo(left)
    expect(result.right![Math.floor(time * SYNTH_RATE)]).toBeCloseTo(right)
  }
})
