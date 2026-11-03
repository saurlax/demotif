import { describe, expect, it } from 'vitest'
import { synthesize, SYNTH_RATE } from './voices'
import { SOUND_IDS, DRUM_KITS } from './soundDefinitions'
import type { Asset } from './model'
const asset: Asset = {
  id: 'test',
  name: 'test',
  kind: 'keys',
  variant: 0,
  duration: 1,
  notes: [{ id: 'n', pitch: 60, start: 0, duration: 0.9, velocity: 0.8 }],
}
const rms = (a: Float32Array) =>
  Math.sqrt(a.reduce((v, x) => v + x * x, 0) / a.length)
function crossings(a: Float32Array) {
  let n = 0
  for (let i = 1; i < a.length; i++) if (a[i] >= 0 && a[i - 1] < 0) n++
  return n
}
describe('factory sound rendering', () => {
  it('renders every synth and drum kit as finite, nonempty, distinct PCM', () => {
    const signatures = new Set<string>()
    for (const sound of SOUND_IDS) {
      const pcm = synthesize({ ...asset, sound })
      expect(pcm.every(Number.isFinite), sound).toBe(true)
      expect(rms(pcm), sound).toBeGreaterThan(0.005)
      signatures.add(Array.from(pcm.slice(200, 250)).join(','))
    }
    expect(signatures.size).toBe(SOUND_IDS.length)
    for (const drumKit of DRUM_KITS) {
      const pcm = synthesize({
        ...asset,
        kind: 'drums',
        drumKit,
        notes: asset.notes!.map((n) => ({ ...n, pitch: 36 })),
      })
      expect(rms(pcm), drumKit).toBeGreaterThan(0.01)
      expect(pcm.every(Number.isFinite)).toBe(true)
    }
  })
  it('applies envelope, cutoff and tuning, including zero attack/decay/release', () => {
    const base = { ...asset, sound: 'square-lead' as const }
    const normal = synthesize(base),
      filtered = synthesize({ ...base, synth: { cutoff: 80 } }),
      slow = synthesize({ ...base, synth: { attack: 0.8 } }),
      zero = synthesize({
        ...base,
        synth: { attack: 0, decay: 0, sustain: 0, release: 0 },
      })
    expect(rms(filtered)).toBeLessThan(rms(normal) * 0.4)
    expect(rms(slow.slice(0, 3000))).toBeLessThan(
      rms(normal.slice(0, 3000)) * 0.3,
    )
    expect(zero.every(Number.isFinite)).toBe(true)
    const sine = { ...asset, sound: 'sub' as const }
    expect(
      crossings(synthesize({ ...sine, synth: { detune: 50 } })),
    ).toBeGreaterThan(crossings(synthesize(sine)))
  })
  it('plays samples at their real root pitch, transposes and loops across the source end', () => {
    const rate = SYNTH_RATE,
      source = {
        rate,
        data: Float32Array.from(
          { length: rate / 4 },
          (_, i) => Math.sin((i * 2 * Math.PI * 220) / rate) * 0.5,
        ),
      }
    const sampled = {
      ...asset,
      sampler: { rootNote: 60 },
      synth: { attack: 0, release: 0, cutoff: 10000 },
    }
    const normal = synthesize(sampled, source),
      octave = synthesize(
        { ...sampled, notes: asset.notes!.map((n) => ({ ...n, pitch: 72 })) },
        source,
      )
    expect(
      Math.abs(crossings(normal.slice(0, rate / 10)) - 22),
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(crossings(octave.slice(0, rate / 10)) - 44),
    ).toBeLessThanOrEqual(1)
    expect(rms(normal.slice(rate / 2))).toBe(0)
    const loop = synthesize(
      { ...sampled, sampler: { rootNote: 60, loopStart: 0.05, loopEnd: 0.2 } },
      source,
    )
    expect(rms(loop.slice(rate / 2, rate * 0.8))).toBeGreaterThan(0.1)
    expect(loop.every(Number.isFinite)).toBe(true)
    let maxJump = 0
    for (let i = (rate * 0.3) | 0; i < rate * 0.8; i++)
      maxJump = Math.max(maxJump, Math.abs(loop[i] - loop[i - 1]))
    expect(maxJump).toBeLessThan(0.08)
  })
  it('lets one-shot tails pass note-off at the transposed length without changing notes', () => {
    const source = {
      rate: SYNTH_RATE,
      data: new Float32Array(SYNTH_RATE / 2).fill(0.3),
    }
    const sampled: Asset = {
      ...asset,
      notes: [
        { id: 'short', pitch: 60, start: 0, duration: 0.05, velocity: 1 },
      ],
      sampler: { rootNote: 60, oneShot: true },
      synth: { attack: 0, release: 0 },
    }
    const normal = synthesize(sampled, source)
    expect(rms(normal.slice(SYNTH_RATE / 10, SYNTH_RATE / 3))).toBeGreaterThan(
      0.25,
    )
    expect(rms(normal.slice(SYNTH_RATE * 0.51))).toBe(0)
    const octave = synthesize(
      { ...sampled, notes: sampled.notes!.map((n) => ({ ...n, pitch: 72 })) },
      source,
    )
    expect(rms(octave.slice(SYNTH_RATE * 0.26))).toBe(0)
    const gated = synthesize({ ...sampled, sampler: { rootNote: 60 } }, source)
    expect(rms(gated.slice(SYNTH_RATE / 10))).toBe(0)
    expect(sampled.notes![0].duration).toBe(0.05)
  })
})

it("uses the original drum sample at full attack and keeps each hit's trimmed duration", () => {
  const source = {
    rate: SYNTH_RATE,
    data: new Float32Array(SYNTH_RATE).fill(0.25),
  }
  const pcm = synthesize(
    {
      ...asset,
      kind: 'drums',
      duration: 1,
      sampler: { rootNote: 36 },
      synth: { attack: 0, release: 0.008, cutoff: 20000 },
      notes: [
        { id: 'kick', pitch: 36, start: 0.25, duration: 0.2, velocity: 1 },
      ],
    },
    source,
  )
  expect(pcm[0]).toBe(0)
  expect(pcm[Math.floor(0.25 * SYNTH_RATE)]).toBe(0.25)
  expect(pcm[Math.floor(0.35 * SYNTH_RATE)]).toBe(0.25)
  expect(pcm[Math.ceil(0.45 * SYNTH_RATE)]).toBe(0)
})
