import type { Asset } from './model'
import { assetNotes } from './sequence'
import { renderOscillators } from './oscillatorVoice'
import { extended, extendedSample, decayFor, softVoice } from './extendedVoices'
export interface SamplePCM {
  data: Float32Array
  rate: number
  right?: Float32Array
  drums?: Record<number, SamplePCM>
}
export const SYNTH_RATE = 22050
const TAU = 2 * Math.PI
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

function saw(phase: number, step: number) {
  let value = phase * 2 - 1
  if (phase < step) {
    const t = phase / step
    value -= t + t - t * t - 1
  } else if (phase > 1 - step) {
    const t = (phase - 1) / step
    value -= t * t + t + t + 1
  }
  return value
}

// Deterministic, band-limited voices. Notes remain the editable source of sound.
export function synthesize(
  asset: Asset,
  source?: SamplePCM,
): Float32Array<ArrayBuffer> {
  if (asset.drumSamples?.length) {
    const { pcm, right } = renderVoice(asset, source)
    for (let i = 0; i < pcm.length; i++)
      pcm[i] = (pcm[i] + (right?.[i] ?? pcm[i])) * 0.5
    return pcm
  }
  if (asset.synth?.oscillators?.length && !asset.sampler) {
    const { pcm, right } = renderOscillators(asset, SYNTH_RATE)
    for (let i = 0; i < pcm.length; i++) pcm[i] = (pcm[i] + right[i]) * 0.5
    return pcm
  }
  const rate = SYNTH_RATE
  const data = new Float32Array(Math.ceil(asset.duration * rate))
  let seed = 41 + asset.variant
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2147483648 - 1
  }
  for (const note of assetNotes(asset)) {
    const base = Math.max(0, Math.floor(note.start * rate))
    const velocity = Math.max(0, Math.min(1, note.velocity))
    if (asset.sampler && source) {
      const step =
        (2 **
          ((note.pitch -
            asset.sampler.rootNote +
            (asset.synth?.detune ?? 0) / 100) /
            12) *
          source.rate) /
        rate
      const loopStart = (asset.sampler.loopStart ?? 0) * source.rate
      const loopEnd = (asset.sampler.loopEnd ?? 0) * source.rate
      const looping =
        !asset.sampler.oneShot &&
        loopEnd > loopStart &&
        loopEnd <= source.data.length
      // FL samplers with the volume envelope disabled play through note-off.
      // Keep the score intact; only the rendered voice uses the natural tail.
      const length = Math.min(
        asset.sampler.oneShot
          ? source.data.length / (step * rate)
          : note.duration,
        asset.duration - note.start,
      )
      const blend = Math.min(source.rate * 0.008, (loopEnd - loopStart) / 4)
      let at = 0,
        filtered = 0
      for (let i = 0; i < length * rate && base + i < data.length; i++) {
        if (looping && at >= loopEnd)
          at =
            loopStart + blend + ((at - loopEnd) % (loopEnd - loopStart - blend))
        if (at >= source.data.length - 1) break
        const index = Math.floor(at),
          fraction = at - index
        let sample =
          source.data[index] * (1 - fraction) +
          source.data[index + 1] * fraction
        // Blend at the loop boundary to avoid a discontinuity on sustained keys.
        if (looping && at > loopEnd - blend) {
          const mix = (at - (loopEnd - blend)) / blend
          const other = Math.floor(loopStart + at - (loopEnd - blend))
          sample = sample * (1 - mix) + (source.data[other] ?? 0) * mix
        }
        const t = i / rate
        const a = asset.synth?.attack ?? 0.005,
          r = asset.synth?.release ?? 0.04
        let envelope = Math.min(
          1,
          a === 0 ? 1 : t / Math.max(0.001, a),
          (length - t) / Math.max(0.001, r),
        )
        if (
          asset.synth?.decay !== undefined ||
          asset.synth?.sustain !== undefined
        ) {
          const d = asset.synth?.decay ?? 0.3,
            s = asset.synth?.sustain ?? 0.8
          envelope *=
            t < a
              ? 1
              : s + (1 - s) * Math.max(0, 1 - (t - a) / Math.max(0.001, d))
        }
        const cutoff = asset.synth?.cutoff ?? 10000
        filtered +=
          (1 - Math.exp((-TAU * Math.min(cutoff, rate * 0.45)) / rate)) *
          (sample - filtered)
        data[base + i] +=
          (cutoff >= 20000 ? sample : filtered) * velocity * envelope
        at += step
      }
      continue
    }
    if (asset.kind === 'drums') {
      const kit = asset.drumKit ?? 'studio'
      const kick = note.pitch === 36 || note.pitch === 35,
        snare = note.pitch === 38 || note.pitch === 40,
        clap = note.pitch === 39,
        rim = note.pitch === 37,
        tom = [41, 43, 45, 47, 48, 50].includes(note.pitch),
        conga = note.pitch >= 60 && note.pitch <= 64,
        cowbell = note.pitch === 56,
        crash = [49, 52, 55, 57].includes(note.pitch),
        ride = [51, 53, 59].includes(note.pitch),
        open = note.pitch === 46
      const length = kick
        ? kit === '808'
          ? 0.85
          : 0.46
        : snare
          ? 0.22
          : clap
            ? 0.22
            : rim
              ? 0.09
              : tom || conga
                ? 0.35
                : cowbell
                  ? 0.2
                  : crash || ride
                    ? 1.6
                    : open
                      ? 0.3
                      : 0.075
      let last = 0,
        smooth = 0
      for (let i = 0; i < length * rate && base + i < data.length; i++) {
        const t = i / rate,
          n = noise()
        const hp = n - last
        last = n
        smooth += 0.18 * (n - smooth)
        let sample: number
        if (kick)
          sample =
            0.92 *
              Math.sin(
                TAU *
                  ((kit === '808' ? 39 : kit === '909' ? 54 : 47) * t +
                    3.5 * (1 - Math.exp(-t * 38))),
              ) *
              Math.exp(-t * (kit === '808' ? 7 : kit === '909' ? 15 : 12)) +
            hp * 0.07 * Math.exp(-t * 100)
        else if (snare)
          sample =
            (hp * 0.23 + Math.sin(TAU * 185 * t) * 0.2) * Math.exp(-t * 20)
        else if (clap) {
          const burst =
            Math.exp(-t * 45) +
            (t > 0.011 ? Math.exp(-(t - 0.011) * 70) : 0) +
            (t > 0.023 ? Math.exp(-(t - 0.023) * 26) : 0)
          sample = (n - smooth) * 0.27 * burst
        } else if (tom || conga) {
          const hz = conga
            ? 180 + (note.pitch - 60) * 35
            : 90 + (note.pitch - 41) * 16
          sample =
            (Math.sin(TAU * (hz * t + 0.8 * (1 - Math.exp(-t * 35)))) * 0.5 +
              hp * 0.04) *
            Math.exp(-t * (conga ? 20 : 12))
        } else if (cowbell)
          sample =
            (Math.sin(TAU * 540 * t) + Math.sin(TAU * 800 * t)) *
            0.2 *
            Math.exp(-t * 23)
        else if (rim)
          sample =
            (Math.sin(TAU * 820 * t) + Math.sin(TAU * 1250 * t)) *
            0.24 *
            Math.exp(-t * 65)
        else if (note.pitch === 75)
          sample =
            (Math.sin(TAU * 2200 * t) + Math.sin(TAU * 3300 * t) * 0.3) *
            Math.exp(-t * 95) *
            0.4
        else if (note.pitch === 54)
          sample =
            (hp * 0.15 + Math.sin(TAU * 4800 * t) * 0.06) * Math.exp(-t * 32)
        else if (note.pitch === 82 || note.pitch === 70 || note.pitch === 69)
          sample = (n - smooth) * 0.2 * Math.exp(-t * 45)
        else
          sample =
            hp *
              (crash ? 0.17 : ride ? 0.08 : open ? 0.13 : 0.12) *
              Math.exp(-t * (crash ? 3 : ride ? 6 : open ? 15 : 65)) +
            (crash ? Math.sin(TAU * 6300 * t) * 0.015 * Math.exp(-t * 5) : 0)
        if (kit === '909' && !kick)
          sample =
            sample * 0.85 + Math.sin(TAU * 320 * t) * 0.06 * Math.exp(-t * 26)
        if (kit === '808' && snare)
          sample =
            sample * 0.7 + Math.sin(TAU * 285 * t) * 0.14 * Math.exp(-t * 22)
        if (kit === 'lofi') {
          sample = Math.round(sample * 30) / 30
          smooth += 0.2 * (sample - smooth)
          sample = smooth * 0.85
        }
        data[base + i] += sample * velocity * Math.min(1, t / 0.0015)
      }
      continue
    }
    const voice =
      asset.sound ??
      (asset.kind === 'bass' ? 'sub' : asset.kind === 'pad' ? 'air' : 'piano')
    const hz = frequency(note.pitch + (asset.synth?.detune ?? 0) / 100)
    const length = Math.min(note.duration, asset.duration - note.start)
    const count = Math.max(0, Math.floor(length * rate))
    const detunes =
      voice === 'supersaw'
        ? [-0.009, -0.004, 0, 0.004, 0.009]
        : voice === 'reese'
          ? [-0.008, 0.008]
          : voice === 'lead'
            ? [-0.003, 0, 0.003]
            : [0]
    const phases = Array.from(
      { length: Math.max(5, detunes.length) },
      (_, i) => i * 0.173,
    )
    let filtered = 0,
      toneFiltered = 0
    for (let i = 0; i < count && base + i < data.length; i++) {
      const t = i / rate
      const attack =
        asset.synth?.attack ??
        (extended.has(voice)
          ? softVoice(voice)
            ? 0.18
            : 0.004
          : voice === 'air'
            ? 0.2
            : voice === 'strings'
              ? 0.055
              : voice === 'flute'
                ? 0.025
                : voice === 'brass'
                  ? 0.018
                  : 0.006)
      const release =
        asset.synth?.release ??
        (voice === 'air'
          ? 0.3
          : voice === 'strings'
            ? 0.14
            : voice === 'piano' || voice === 'electric-piano'
              ? 0.12
              : 0.035)
      const envelope =
        Math.min(
          1,
          t / Math.max(0.001, attack),
          (length - t) / Math.max(0.001, release),
        ) *
        Math.exp(
          -t *
            (extended.has(voice)
              ? decayFor(voice)
              : voice === 'pluck'
                ? 9
                : voice === 'piano' || voice === 'electric-piano'
                  ? 1.25
                  : voice === 'guitar'
                    ? 2.4
                    : voice === 'electric-bass'
                      ? 1.4
                      : voice === 'air' ||
                          voice === 'strings' ||
                          voice === 'flute' ||
                          voice === 'organ'
                        ? 0.1
                        : voice === 'sub'
                          ? 0.22
                          : 0.35),
        )
      let sample = 0
      if (extended.has(voice))
        sample = extendedSample(voice, hz, t, rate, phases, noise, saw)
      else if (voice === 'sub')
        sample =
          (Math.sin(TAU * hz * t) + 0.1 * Math.sin(TAU * hz * 2 * t)) * 0.45
      else if (voice === 'electric-piano') {
        const fm = Math.sin(TAU * hz * t * 2) * 1.5 * Math.exp(-t * 5)
        sample =
          (Math.sin(TAU * hz * t + fm) +
            0.12 * Math.sin(TAU * hz * 3 * t) * Math.exp(-t * 8)) *
          0.27
      } else if (voice === 'guitar' || voice === 'electric-bass') {
        const bass = voice === 'electric-bass'
        sample =
          (Math.sin(TAU * hz * t) +
            0.38 * Math.sin(TAU * hz * 2 * t) * Math.exp(-t * 3) +
            0.2 * Math.sin(TAU * hz * 3 * t) * Math.exp(-t * 5) +
            0.09 * Math.sin(TAU * hz * 5 * t) * Math.exp(-t * 9)) *
          (bass ? 0.42 : 0.28)
      } else if (voice === 'flute') {
        const phase = TAU * hz * t + 0.035 * Math.sin(TAU * 5.2 * t)
        sample =
          (Math.sin(phase) + 0.17 * Math.sin(2 * phase) + 0.04 * noise()) * 0.25
      } else if (voice === 'organ')
        sample =
          (Math.sin(TAU * hz * t) +
            0.45 * Math.sin(TAU * hz * 2 * t) +
            0.2 * Math.sin(TAU * hz * 3 * t) +
            0.1 * Math.sin(TAU * hz * 4 * t)) *
          0.2
      else if (voice === 'strings' || voice === 'brass') {
        const vibrato = 0.0025 * Math.sin(TAU * 5.1 * t)
        const step = (hz * (1 + vibrato)) / rate
        phases[0] = (phases[0] + step) % 1
        const raw = saw(phases[0], step) * 0.32
        const cutoff =
          voice === 'brass' ? 1100 + 3200 * Math.exp(-t * 5) : 1900 + hz * 0.7
        filtered +=
          (1 - Math.exp((-TAU * Math.min(cutoff, rate * 0.4)) / rate)) *
          (raw - filtered)
        sample =
          filtered +
          Math.sin(TAU * hz * t * 0.9985) * (voice === 'strings' ? 0.07 : 0.025)
      } else if (voice === 'piano' || voice === 'pluck')
        sample =
          (Math.sin(TAU * hz * t) +
            0.32 * Math.sin(TAU * hz * 2 * t) * Math.exp(-t * 3) +
            0.12 * Math.sin(TAU * hz * 3 * t) * Math.exp(-t * 5)) *
          (voice === 'pluck' ? 0.23 : 0.25)
      else if (voice === 'air')
        sample =
          (Math.sin(TAU * hz * t) +
            0.35 * Math.sin(TAU * hz * 1.003 * t) +
            0.14 * Math.sin(TAU * hz * 2 * t)) *
          0.13
      else {
        for (let v = 0; v < detunes.length; v++) {
          const step = Math.min(0.45, (hz * (1 + detunes[v])) / rate)
          phases[v] = (phases[v] + step) % 1
          sample += saw(phases[v], step)
        }
        sample *=
          (voice === 'lead' ? 0.37 : voice === 'reese' ? 0.32 : 0.34) /
          detunes.length
        const cutoff = voice === 'reese' ? 1700 : voice === 'lead' ? 6500 : 4500
        filtered +=
          (1 - Math.exp((-TAU * Math.min(cutoff, rate * 0.4)) / rate)) *
          (sample - filtered)
        sample = filtered
      }
      let env = envelope
      if (
        asset.synth?.decay !== undefined ||
        asset.synth?.sustain !== undefined
      ) {
        const d = asset.synth?.decay ?? 0.3,
          s = asset.synth?.sustain ?? 0.7
        env =
          Math.min(
            1,
            t / Math.max(0.001, attack),
            (length - t) / Math.max(0.001, release),
          ) *
          (t < attack
            ? 1
            : s + (1 - s) * Math.max(0, 1 - (t - attack) / Math.max(0.001, d)))
      }
      if (asset.synth?.cutoff !== undefined || extended.has(voice)) {
        const cutoff =
          asset.synth?.cutoff ??
          (voice === 'acid-bass'
            ? 450 + 1800 * Math.exp(-t * 9)
            : voice === 'warm-pad'
              ? 1800
              : voice === 'synth-brass'
                ? 1000 + 2600 * Math.exp(-t * 5)
                : 8000)
        toneFiltered +=
          (1 - Math.exp((-TAU * Math.min(cutoff, rate * 0.45)) / rate)) *
          (sample - toneFiltered)
        sample = toneFiltered
      }
      data[base + i] += sample * env * velocity
    }
  }
  return data
}

export function renderVoice(asset: Asset, source?: SamplePCM) {
  if (asset.drumSamples?.length) {
    const pcm = new Float32Array(Math.ceil(asset.duration * SYNTH_RATE)),
      right = new Float32Array(pcm.length)
    for (const row of asset.drumSamples) {
      const sample = source?.drums?.[row.pitch]
      if (!sample) throw new Error(`采样尚未载入：${row.name}`)
      const notes = assetNotes(asset)
        .filter((n) => n.pitch === row.pitch)
        .map((n) => ({ ...n, velocity: n.velocity * (row.gain ?? 1) }))
      const rendered = renderVoice(
        {
          ...asset,
          drumSamples: undefined,
          sampler: { rootNote: row.pitch },
          notes,
        },
        sample,
      )
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] += rendered.pcm[i]
        right[i] += rendered.right?.[i] ?? rendered.pcm[i]
      }
    }
    return { pcm, right }
  }
  if (asset.synth?.oscillators?.length && !asset.sampler)
    return renderOscillators(asset, SYNTH_RATE)
  const pcm = synthesize(asset, source)
  const right =
    source?.right && asset.sampler
      ? synthesize(asset, { data: source.right, rate: source.rate })
      : undefined
  return { pcm, ...(right ? { right } : {}) }
}
