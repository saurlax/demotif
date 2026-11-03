import type { Asset } from './model'
import { assetNotes } from './sequence'

// Our editable synth engine: not a Serum/Vital binary or preset interpreter.
// PolyBLEP bounds discontinuities before filtering; detuned voices are panned
// independently while a single centered sub remains identical in both channels.
const TAU = Math.PI * 2
function blep(t: number, dt: number) {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}
function wave(type: string, phase: number, step: number) {
  if (type === 'sine') return Math.sin(phase * TAU)
  if (type === 'triangle')
    return (2 / Math.PI) * Math.asin(Math.sin(phase * TAU))
  if (type === 'square')
    return (
      (phase < 0.5 ? 1 : -1) + blep(phase, step) - blep((phase + 0.5) % 1, step)
    )
  return 2 * phase - 1 - blep(phase, step)
}
export function renderOscillators(asset: Asset, rate: number) {
  const pcm = new Float32Array(Math.ceil(asset.duration * rate))
  const right = new Float32Array(pcm.length)
  const settings = asset.synth!
  const oscillators = settings.oscillators!
  for (const [ni, note] of assetNotes(asset).entries()) {
    const base = Math.max(0, Math.floor(note.start * rate))
    const attack = settings.attack ?? 0.0005,
      decay = settings.decay ?? 0.3
    const sustain = settings.sustain ?? 1,
      release = settings.release ?? 0.05
    const length = Math.min(
      asset.duration - note.start,
      note.duration + release,
    )
    const states = oscillators.flatMap((osc, oi) => {
      const voices = Math.max(1, Math.min(16, Math.round(osc.voices)))
      return Array.from({ length: voices }, (_, vi) => {
        const position = voices === 1 ? 0 : (vi / (voices - 1)) * 2 - 1
        const cents = position * osc.detune + (settings.detune ?? 0)
        const hz =
          440 * 2 ** ((note.pitch + osc.transpose - 69 + cents / 100) / 12)
        const pan = Math.max(
          -1,
          Math.min(1, position * osc.spread + (osc.pan ?? 0)),
        )
        return {
          osc,
          step: Math.min(0.45, hz / rate),
          phase:
            voices === 1
              ? 0
              : ((ni * 73 + oi * 193 + vi * 137 + 41) % 997) / 997,
          left: Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2,
          right: Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2,
          level: (osc.level / Math.sqrt(voices)) * 0.28,
        }
      })
    })
    const cutoff = Math.max(
      20,
      Math.min(
        rate * 0.45,
        (settings.cutoff ?? 20000) *
          2 ** (((note.pitch - 60) * (settings.keytrack ?? 0)) / 12),
      ),
    )
    // Topology-preserving state-variable lowpass, independently per channel.
    const g = Math.tan((Math.PI * cutoff) / rate),
      k = 1 / (0.5 + (settings.resonance ?? 0) * 2)
    const a1 = 1 / (1 + g * (g + k)),
      a2 = g * a1,
      a3 = g * a2
    let l1 = 0,
      l2 = 0,
      r1 = 0,
      r2 = 0
    const drive = 10 ** ((settings.filterDrive ?? 0) / 20)
    const filter = (input: number, channel: number) => {
      const x =
        drive === 1 ? input : Math.tanh(input * drive) / Math.sqrt(drive)
      const ic1 = channel ? r1 : l1,
        ic2 = channel ? r2 : l2
      const v3 = x - ic2,
        v1 = a1 * ic1 + a2 * v3,
        v2 = ic2 + a2 * ic1 + a3 * v3
      if (channel) {
        r1 = 2 * v1 - ic1
        r2 = 2 * v2 - ic2
      } else {
        l1 = 2 * v1 - ic1
        l2 = 2 * v2 - ic2
      }
      return v2
    }
    const envelopeAt = (t: number) =>
      t < attack
        ? t / Math.max(attack, 1 / rate)
        : sustain +
          (1 - sustain) *
            Math.max(0, 1 - (t - attack) / Math.max(decay, 1 / rate))
    const releaseLevel = envelopeAt(note.duration)
    for (let i = 0; i < length * rate && base + i < pcm.length; i++) {
      let left = 0,
        r = 0,
        dryL = 0,
        dryR = 0
      for (const state of states) {
        const sample =
          wave(state.osc.wave, state.phase, state.step) * state.level
        state.phase = (state.phase + state.step) % 1
        if (state.osc.bypassFilter) {
          dryL += sample * state.left
          dryR += sample * state.right
        } else {
          left += sample * state.left
          r += sample * state.right
        }
      }
      const t = i / rate
      const envelope =
        Math.max(
          0,
          t < note.duration
            ? envelopeAt(t)
            : releaseLevel *
                (1 - (t - note.duration) / Math.max(release, 1 / rate)),
        ) * note.velocity
      pcm[base + i] += (filter(left, 0) + dryL) * envelope
      right[base + i] += (filter(r, 1) + dryR) * envelope
    }
  }
  return { pcm, right }
}
