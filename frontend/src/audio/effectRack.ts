import type { TrackEffects } from './model'

export type EffectKey = Exclude<keyof TrackEffects, 'compressor'>
export interface DialParameter {
  key: string
  name: string
  min: number
  max: number
  step: number
  off: number
  initial: number
  unit: '%' | 'Hz' | 'dB' | 'ms' | 'ct' | 'st' | ''
  log?: boolean
}
export interface EffectParameter extends DialParameter {
  key: EffectKey
}
export interface EffectModule {
  id: string
  name: string
  title: string
  parameters: EffectParameter[]
}
const amount = (
  key: EffectKey,
  name: string,
  max = 1,
  initial = 0,
): EffectParameter => ({
  key,
  name,
  min: 0,
  max,
  step: 0.01,
  off: 0,
  initial,
  unit: '%',
})
export const EFFECT_MODULES: EffectModule[] = [
  {
    id: 'filter',
    name: '滤波',
    title: 'FILTER',
    parameters: [
      {
        key: 'highpass',
        name: '高通',
        min: 20,
        max: 20000,
        step: 1,
        off: 0,
        initial: 150,
        unit: 'Hz',
        log: true,
      },
      {
        key: 'lowpass',
        name: '低通',
        min: 20,
        max: 20000,
        step: 10,
        off: 20000,
        initial: 20000,
        unit: 'Hz',
        log: true,
      },
    ],
  },
  {
    id: 'drive',
    name: '失真',
    title: 'SATURATION',
    parameters: [amount('drive', '驱动', 1, 0.2)],
  },
  {
    id: 'compressor',
    name: '压缩',
    title: 'COMPRESSOR',
    parameters: [
      {
        key: 'threshold',
        name: '阈值',
        min: -60,
        max: 0,
        step: 0.5,
        off: -20,
        initial: -20,
        unit: 'dB',
      },
      {
        key: 'ratio',
        name: '比率',
        min: 1,
        max: 20,
        step: 0.1,
        off: 3,
        initial: 3,
        unit: '',
      },
      {
        key: 'compAttack',
        name: '起音',
        min: 0,
        max: 0.2,
        step: 0.001,
        off: 0.008,
        initial: 0.008,
        unit: 'ms',
      },
      {
        key: 'compRelease',
        name: '释放',
        min: 0.01,
        max: 1,
        step: 0.005,
        off: 0.16,
        initial: 0.16,
        unit: 'ms',
      },
    ],
  },
  {
    id: 'eq',
    name: '均衡',
    title: 'EQUALIZER',
    parameters: [
      {
        key: 'lowShelf',
        name: '低频 · 250 Hz',
        min: -12,
        max: 12,
        step: 0.5,
        off: 0,
        initial: 3,
        unit: 'dB',
      },
      {
        key: 'highShelf',
        name: '高频 · 5 kHz',
        min: -12,
        max: 12,
        step: 0.5,
        off: 0,
        initial: 0,
        unit: 'dB',
      },
    ],
  },
  {
    id: 'bitcrusher',
    name: '位深',
    title: 'BITCRUSHER',
    parameters: [amount('bitcrusher', '降质', 1, 0.5)],
  },
  {
    id: 'modulation',
    name: '调制',
    title: 'MODULATION',
    parameters: [
      amount('phaser', '移相'),
      amount('chorus', '合唱', 1, 0.25),
      amount('tremolo', '颤音'),
      amount('autopan', '自动声像'),
    ],
  },
  {
    id: 'pan',
    name: '声像',
    title: 'STEREO PAN',
    parameters: [
      {
        key: 'pan',
        name: '左右',
        min: -1,
        max: 1,
        step: 0.01,
        off: 0,
        initial: 0.2,
        unit: '%',
      },
    ],
  },
  {
    id: 'delay',
    name: '延迟',
    title: 'DELAY',
    parameters: [amount('delay', '湿声', 1, 0.18)],
  },
  {
    id: 'reverb',
    name: '混响',
    title: 'REVERB',
    parameters: [amount('reverb', '湿声', 1, 0.2)],
  },
  {
    id: 'sidechain',
    name: '侧链',
    title: 'SIDECHAIN',
    parameters: [amount('sidechain', '深度', 1, 0.5)],
  },
  {
    id: 'softClip',
    name: '软削波',
    title: 'SOFT CLIPPER',
    parameters: [amount('softClip', '削波', 1, 0.3)],
  },
  {
    id: 'width',
    name: '立体声',
    title: 'STEREO WIDTH',
    parameters: [
      {
        key: 'width',
        name: '宽度',
        min: 0,
        max: 2,
        step: 0.01,
        off: 1,
        initial: 1.3,
        unit: '%',
      },
    ],
  },
  {
    id: 'air',
    name: '空气感',
    title: 'AIR',
    parameters: [amount('air', '高频', 1, 0.3)],
  },
  {
    id: 'multiband',
    name: '多段压缩',
    title: 'MULTIBAND',
    parameters: [amount('multiband', '压缩量', 1, 0.4)],
  },
]
export function moduleEnabled(module: EffectModule, effects: TrackEffects) {
  return module.id === 'compressor'
    ? !!effects.compressor
    : module.parameters.some((p) => (effects[p.key] ?? p.off) !== p.off)
}
export function parameterPosition(p: DialParameter, value: number) {
  const v = Math.max(p.min, Math.min(p.max, value))
  return p.log
    ? Math.log(v / p.min) / Math.log(p.max / p.min)
    : (v - p.min) / (p.max - p.min)
}
export function parameterValue(p: DialParameter, position: number) {
  const t = Math.max(0, Math.min(1, position))
  const v = p.log ? p.min * (p.max / p.min) ** t : p.min + t * (p.max - p.min)
  return Math.max(p.min, Math.min(p.max, Math.round(v / p.step) * p.step))
}
export function formatParameter(p: DialParameter, value: number) {
  if (p.key === 'highpass' && value === 0) return 'OFF'
  if (p.key === 'pan')
    return value === 0
      ? 'C'
      : `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`
  if (p.unit === 'Hz')
    return value >= 1000
      ? `${Number((value / 1000).toFixed(2))} kHz`
      : `${Math.round(value)} Hz`
  if (p.unit === 'dB') return `${value > 0 ? '+' : ''}${value} dB`
  if (p.unit === '%') return `${Math.round(value * 100)} %`
  if (p.unit === 'ms') return `${Math.round(value * 1000)} ms`
  return `${Number(value.toFixed(2))}${p.unit ? ` ${p.unit}` : ''}`
}

// RBJ biquad response, matching the Web Audio filter nodes at the render rate.
export function filterResponse(
  frequency: number,
  fx: TrackEffects,
  sampleRate = 44100,
) {
  let db = 0
  const response = (type: string, cutoff: number, gain = 0) => {
    const w = (2 * Math.PI * Math.min(cutoff, sampleRate * 0.499)) / sampleRate
    const c = Math.cos(w),
      s = Math.sin(w),
      A = 10 ** (gain / 40)
    // Web Audio interprets Q for high/low pass in dB (the engine sets Q=0.7).
    const alpha = s / (2 * 10 ** (0.7 / 20))
    let b: number[], a: number[]
    if (type === 'highpass' || type === 'lowpass') {
      const h = type === 'highpass'
      b = h
        ? [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        : [(1 - c) / 2, 1 - c, (1 - c) / 2]
      a = [1 + alpha, -2 * c, 1 - alpha]
    } else {
      const t = (2 * Math.sqrt(A) * s) / Math.sqrt(2)
      if (type === 'lowshelf') {
        b = [
          A * (A + 1 - (A - 1) * c + t),
          2 * A * (A - 1 - (A + 1) * c),
          A * (A + 1 - (A - 1) * c - t),
        ]
        a = [
          A + 1 + (A - 1) * c + t,
          -2 * (A - 1 + (A + 1) * c),
          A + 1 + (A - 1) * c - t,
        ]
      } else {
        b = [
          A * (A + 1 + (A - 1) * c + t),
          -2 * A * (A - 1 + (A + 1) * c),
          A * (A + 1 + (A - 1) * c - t),
        ]
        a = [
          A + 1 - (A - 1) * c + t,
          2 * (A - 1 - (A + 1) * c),
          A + 1 - (A - 1) * c - t,
        ]
      }
    }
    const theta = (2 * Math.PI * frequency) / sampleRate
    const magnitude = (v: number[]) =>
      (v[0] + v[1] * Math.cos(theta) + v[2] * Math.cos(2 * theta)) ** 2 +
      (v[1] * Math.sin(theta) + v[2] * Math.sin(2 * theta)) ** 2
    return 10 * Math.log10(Math.max(1e-12, magnitude(b) / magnitude(a)))
  }
  if (fx.highpass) db += response('highpass', fx.highpass)
  if (fx.lowpass && fx.lowpass < 20000) db += response('lowpass', fx.lowpass)
  if (fx.lowShelf) db += response('lowshelf', 250, fx.lowShelf)
  if (fx.highShelf) db += response('highshelf', 5000, fx.highShelf)
  return db
}
