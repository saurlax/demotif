import type { Sound } from './soundDefinitions'
const TAU = Math.PI * 2
export const extended = new Set<Sound>([
  'analog-lead',
  'square-lead',
  'fm-bell',
  'mallet',
  'music-box',
  'kalimba',
  'nylon-guitar',
  'clav',
  'acid-bass',
  'fm-bass',
  'organ-bass',
  'warm-pad',
  'choir-pad',
  'glass-pad',
  'string-ensemble',
  'synth-brass',
])
export const softVoice = (voice: Sound) =>
  ['warm-pad', 'choir-pad', 'glass-pad', 'string-ensemble'].includes(voice)
const decays: Partial<Record<Sound, number>> = {
  'fm-bell': 2.2,
  mallet: 4.5,
  'music-box': 3.8,
  kalimba: 5.5,
  'nylon-guitar': 2.7,
  clav: 8,
  'acid-bass': 1.4,
  'fm-bass': 2.2,
}
export const decayFor = (voice: Sound) => decays[voice] ?? 0.12

export function extendedSample(
  voice: Sound,
  hz: number,
  t: number,
  rate: number,
  phases: number[],
  noise: () => number,
  saw: (phase: number, step: number) => number,
) {
  const p = TAU * hz * t,
    sine = Math.sin(p)
  if (voice === 'fm-bell')
    return (
      (Math.sin(p + Math.sin(p * 3.01) * 3.2 * Math.exp(-t * 2.5)) +
        0.25 * Math.sin(p * 2.756) * Math.exp(-t * 4)) *
      0.25
    )
  if (voice === 'mallet')
    return (
      (sine +
        0.32 * Math.sin(p * 3.99) * Math.exp(-t * 7) +
        0.14 * Math.sin(p * 9.2) * Math.exp(-t * 16)) *
      0.3
    )
  if (voice === 'music-box')
    return (
      (sine +
        0.45 * Math.sin(p * 2.01) * Math.exp(-t * 5) +
        0.18 * Math.sin(p * 5.94) * Math.exp(-t * 8)) *
      0.24
    )
  if (voice === 'kalimba')
    return (
      (sine +
        0.3 * Math.sin(p * 2.76) * Math.exp(-t * 10) +
        noise() * 0.1 * Math.exp(-t * 90)) *
      0.32
    )
  if (voice === 'nylon-guitar')
    return (
      (sine +
        0.23 * Math.sin(p * 2) * Math.exp(-t * 3) +
        0.12 * Math.sin(p * 3) * Math.exp(-t * 7) +
        noise() * 0.06 * Math.exp(-t * 70)) *
      0.32
    )
  if (voice === 'fm-bass')
    return Math.sin(p + Math.sin(p * 2) * 2.8 * Math.exp(-t * 7)) * 0.4
  if (voice === 'organ-bass')
    return (sine + 0.3 * Math.sin(p * 2) + 0.12 * Math.sin(p * 4)) * 0.32
  if (voice === 'clav')
    return (
      (Math.sin(p + Math.sin(p * 3) * 1.6 * Math.exp(-t * 15)) +
        0.15 * Math.sin(p * 7) * Math.exp(-t * 10)) *
      0.28
    )
  if (voice === 'glass-pad')
    return (
      (sine +
        0.3 * Math.sin(p * 2 + 0.3 * Math.sin(TAU * 0.4 * t)) +
        0.15 * Math.sin(p * 3.002)) *
      0.19
    )
  if (voice === 'choir-pad') {
    // Formant-weighted harmonics, rather than a sampled or cloned singer.
    let value = 0
    for (let n = 1; n <= Math.min(18, Math.floor((rate * 0.42) / hz)); n++) {
      const f = n * hz
      const weight =
        0.08 / n +
        0.5 * Math.exp(-(((f - 750) / 240) ** 2)) +
        0.25 * Math.exp(-(((f - 1200) / 360) ** 2))
      value += Math.sin(p * n + Math.sin(TAU * 4.8 * t) * n * 0.018) * weight
    }
    return value * 0.15
  }
  let result = 0
  const count = voice === 'string-ensemble' ? 5 : voice === 'warm-pad' ? 3 : 2
  for (let i = 0; i < count; i++) {
    const detune =
      (i - (count - 1) / 2) * (voice === 'string-ensemble' ? 0.003 : 0.0025)
    const step = Math.min(0.45, (hz * (1 + detune)) / rate)
    phases[i] = (phases[i] + step) % 1
    let v = saw(phases[i], step)
    if (voice === 'square-lead')
      v = (v - saw((phases[i] + 0.5) % 1, step)) * 0.6
    if (voice === 'acid-bass') v = (v + sine * 0.5) * 0.6
    result += v / count
  }
  return (
    result * (softVoice(voice) ? 0.22 : voice === 'acid-bass' ? 0.38 : 0.29)
  )
}
