import type { TrackEffects, AutomationLane } from './model'
import { scheduleAutomation, automationValue } from './mixer'
const impulses = new Map<number, AudioBuffer>()
export const duckLevel = (seconds: number, bpm: number, amount: number) =>
  1 - amount * ((1 + Math.cos((2 * Math.PI * seconds * bpm) / 60)) / 2) ** 3

function impulse(ctx: BaseAudioContext) {
  let buffer = impulses.get(ctx.sampleRate)
  if (buffer) return buffer
  buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2.2), ctx.sampleRate)
  let seed = 2718
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let filtered = 0
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const noise = seed / 2147483648 - 1
      filtered += 0.42 * (noise - filtered)
      data[i] =
        filtered *
        (1 - i / data.length) ** 3.1 *
        (i < ctx.sampleRate * 0.018 ? 0 : 1)
    }
  }
  impulses.set(ctx.sampleRate, buffer)
  return buffer
}

export function createMaster(ctx: BaseAudioContext, destination: AudioNode) {
  const input = ctx.createGain()
  input.gain.value = 0.85
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.knee.value = 4
  limiter.ratio.value = 12
  limiter.attack.value = 0.003
  limiter.release.value = 0.12
  input.connect(limiter)
  limiter.connect(destination)
  return {
    input,
    dispose: () => {
      input.disconnect()
      limiter.disconnect()
    },
  }
}

export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  volume: number,
  fx: TrackEffects = {},
  bpm = 128,
  from = 0,
  when = 0,
  automation: AutomationLane[] = [],
  loop?: { start: number; length: number; phase: number },
) {
  const params: Partial<Record<AutomationLane['parameter'], AudioParam>> = {}
  const nodes: AudioNode[] = []
  const modulators: OscillatorNode[] = []
  const automationSources: AudioBufferSourceNode[] = []
  const modulate = (
    param: AudioParam,
    frequency: number,
    depth: number,
    base: number,
    phase = 0,
  ) => {
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain()
    const angle = 2 * Math.PI * frequency * from + phase
    oscillator.frequency.value = frequency
    oscillator.setPeriodicWave(
      ctx.createPeriodicWave(
        new Float32Array([0, Math.sin(angle)]),
        new Float32Array([0, Math.cos(angle)]),
        { disableNormalization: true },
      ),
    )
    gain.gain.value = depth
    param.value = base
    oscillator.connect(gain)
    gain.connect(param)
    oscillator.start(when)
    nodes.push(oscillator, gain)
    modulators.push(oscillator)
  }
  const input = ctx.createGain()
  nodes.push(input)
  let tail: AudioNode = input
  const add = (node: AudioNode) => {
    nodes.push(node)
    tail.connect(node)
    tail = node
  }
  if (fx.highpass || automation.some((l) => l.parameter === 'highpass')) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = fx.highpass ?? 20
    params.highpass = filter.frequency
    filter.Q.value = 0.7
    add(filter)
  }
  if (
    (fx.lowpass && fx.lowpass < 20000) ||
    automation.some((l) => l.parameter === 'lowpass')
  ) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = fx.lowpass ?? 20000
    params.lowpass = filter.frequency
    filter.Q.value = 0.7
    add(filter)
  }
  if (fx.drive) {
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(2048)
    const strength = 1 + fx.drive * 12
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / (curve.length - 1) - 1
      curve[i] = Math.tanh(x * strength) / Math.tanh(strength)
    }
    shaper.curve = curve
    shaper.oversample = '2x'
    add(shaper)
  }
  if (fx.compressor) {
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = fx.threshold ?? -20
    compressor.knee.value = 12
    compressor.ratio.value = fx.ratio ?? 3
    compressor.attack.value = fx.compAttack ?? 0.008
    compressor.release.value = fx.compRelease ?? 0.16
    add(compressor)
  }
  for (const [type, amount, frequency] of [
    ['lowshelf', fx.lowShelf, 250],
    ['highshelf', fx.highShelf, 5000],
  ] as const) {
    const parameter = type === 'lowshelf' ? 'lowShelf' : 'highShelf'
    if (amount || automation.some((l) => l.parameter === parameter)) {
      const filter = ctx.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      filter.gain.value = amount ?? 0
      params[parameter] = filter.gain
      add(filter)
    }
  }
  if (fx.bitcrusher) {
    const quantizer = ctx.createWaveShaper(),
      curve = new Float32Array(8192),
      levels = 2 ** Math.round(12 - fx.bitcrusher * 9)
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / (curve.length - 1) - 1
      curve[i] = Math.round(x * levels) / levels
    }
    quantizer.curve = curve
    quantizer.oversample = 'none'
    add(quantizer)
  }
  if (fx.phaser) {
    const dry = tail,
      mix = ctx.createGain(),
      wet = ctx.createGain()
    dry.connect(mix)
    wet.gain.value = fx.phaser * 0.65
    let allpass: AudioNode = dry
    for (let i = 0; i < 4; i++) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'allpass'
      filter.Q.value = 0.7
      allpass.connect(filter)
      allpass = filter
      modulate(filter.frequency, bpm / 60 / 8, 180 * (i + 1), 400 * (i + 1))
      nodes.push(filter)
    }
    allpass.connect(wet)
    wet.connect(mix)
    tail = mix
    nodes.push(mix, wet)
  }
  if (fx.chorus) {
    const dry = tail,
      mix = ctx.createGain()
    dry.connect(mix)
    nodes.push(mix)
    for (const side of [-1, 1]) {
      const delay = ctx.createDelay(0.1),
        wet = ctx.createGain(),
        pan = ctx.createStereoPanner()
      wet.gain.value = fx.chorus * 0.35
      pan.pan.value = side * 0.6
      dry.connect(delay)
      delay.connect(wet)
      wet.connect(pan)
      pan.connect(mix)
      modulate(
        delay.delayTime,
        bpm / 60 / 8,
        0.003,
        0.018,
        (side * Math.PI) / 2,
      )
      nodes.push(delay, wet, pan)
    }
    tail = mix
  }
  if (fx.tremolo) {
    const gain = ctx.createGain()
    add(gain)
    modulate(gain.gain, bpm / 60, fx.tremolo * 0.5, 1 - fx.tremolo * 0.5)
  }
  if (fx.autopan) {
    const pan = ctx.createStereoPanner()
    add(pan)
    modulate(pan.pan, bpm / 60 / 8, fx.autopan, 0)
  }
  if (fx.pan) {
    const pan = ctx.createStereoPanner()
    pan.pan.value = fx.pan
    add(pan)
  }
  const sum = ctx.createGain()
  nodes.push(sum)
  tail.connect(sum)
  if (fx.delay) {
    const delay = ctx.createDelay(2),
      feedback = ctx.createGain(),
      wet = ctx.createGain(),
      filter = ctx.createBiquadFilter()
    delay.delayTime.value = (60 / bpm) * 0.75
    feedback.gain.value = 0.31
    wet.gain.value = fx.delay
    filter.type = 'lowpass'
    filter.frequency.value = 4800
    tail.connect(delay)
    delay.connect(filter)
    filter.connect(feedback)
    feedback.connect(delay)
    filter.connect(wet)
    wet.connect(sum)
    nodes.push(delay, feedback, wet, filter)
  }
  if (fx.reverb) {
    const reverb = ctx.createConvolver(),
      wet = ctx.createGain()
    reverb.buffer = impulse(ctx)
    wet.gain.value = fx.reverb
    tail.connect(reverb)
    reverb.connect(wet)
    wet.connect(sum)
    nodes.push(reverb, wet)
  }
  let final: AudioNode = sum
  const append = (node: AudioNode) => {
    final.connect(node)
    final = node
    nodes.push(node)
  }
  if (fx.air) {
    const air = ctx.createBiquadFilter()
    air.type = 'highshelf'
    air.frequency.value = 8000
    air.gain.value = fx.air * 6
    append(air)
  }
  if (fx.multiband) {
    const source = final,
      mix = ctx.createGain()
    nodes.push(mix)
    const split = (
      input: AudioNode,
      type: BiquadFilterType,
      frequency: number,
      count = 2,
    ) => {
      let tail = input
      for (let i = 0; i < count; i++) {
        const f = ctx.createBiquadFilter()
        f.type = type
        f.frequency.value = frequency
        f.Q.value = type === 'allpass' ? Math.SQRT1_2 : -3.0103
        tail.connect(f)
        tail = f
        nodes.push(f)
      }
      return tail
    }
    const low = split(split(source, 'lowpass', 250), 'allpass', 2500, 1)
    const high = split(source, 'highpass', 250)
    const branches = [
      low,
      split(high, 'lowpass', 2500),
      split(high, 'highpass', 2500),
    ]
    branches.forEach((branch, i) => {
      const comp = ctx.createDynamicsCompressor(),
        makeup = ctx.createGain()
      comp.threshold.value = -28 - i * 4
      comp.knee.value = 12
      comp.ratio.value = 1 + fx.multiband! * 5
      comp.attack.value = 0.005
      comp.release.value = 0.09
      makeup.gain.value = 10 ** ((fx.multiband! * 4) / 20)
      branch.connect(comp)
      comp.connect(makeup)
      makeup.connect(mix)
      nodes.push(comp, makeup)
    })
    final = mix
  }
  if (fx.width !== undefined && fx.width !== 1) {
    const splitter = ctx.createChannelSplitter(2),
      merger = ctx.createChannelMerger(2)
    final.connect(splitter)
    nodes.push(splitter, merger)
    // L'=M+w*S, R'=M-w*S. w=0 mono, w=1 untouched.
    for (let source = 0; source < 2; source++)
      for (let channel = 0; channel < 2; channel++) {
        const gain = ctx.createGain()
        gain.gain.value = (1 + (source === channel ? fx.width : -fx.width)) / 2
        splitter.connect(gain, source)
        gain.connect(merger, 0, channel)
        nodes.push(gain)
      }
    final = merger
  }
  if (fx.softClip) {
    const shaper = ctx.createWaveShaper(),
      curve = new Float32Array(4096)
    const strength = 1 + fx.softClip * 4
    for (let i = 0; i < curve.length; i++)
      curve[i] =
        Math.tanh(((i * 2) / (curve.length - 1) - 1) * strength) / strength
    shaper.curve = curve
    shaper.oversample = '2x'
    append(shaper)
  }
  const output = ctx.createGain()
  output.gain.value = volume
  params.gain = output.gain
  final.connect(output)
  for (const lane of automation) {
    const parameter = params[lane.parameter]
    if (!parameter) continue
    if (loop && loop.length > 0) {
      const rate = 3000,
        samples = Math.max(2, Math.ceil(loop.length * rate))
      const buffer = ctx.createBuffer(1, samples, rate),
        data = buffer.getChannelData(0)
      for (let i = 0; i < samples; i++)
        data[i] = automationValue(lane.points, loop.start + i / rate)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.loopStart = 0
      source.loopEnd = loop.length
      parameter.value = 0
      source.connect(parameter)
      source.start(when, loop.phase % loop.length)
      automationSources.push(source)
      nodes.push(source)
    } else scheduleAutomation(parameter, lane, from, when)
  }
  nodes.push(output)
  let lfo: OscillatorNode | undefined
  if (fx.sidechain) {
    const duck = ctx.createGain()
    final.disconnect(output)
    final.connect(duck)
    duck.connect(output)
    nodes.push(duck)
    const amount = fx.sidechain
    duck.gain.value = 1 - (amount * 5) / 16
    const real = new Float32Array(4),
      imag = new Float32Array(4),
      coeff = [0, 15 / 32, 3 / 16, 1 / 32]
    const phase = (2 * Math.PI * from * bpm) / 60
    for (let n = 1; n < 4; n++) {
      real[n] = -amount * coeff[n] * Math.cos(n * phase)
      imag[n] = amount * coeff[n] * Math.sin(n * phase)
    }
    lfo = ctx.createOscillator()
    lfo.frequency.value = bpm / 60
    lfo.setPeriodicWave(
      ctx.createPeriodicWave(real, imag, { disableNormalization: true }),
    )
    lfo.connect(duck.gain)
    lfo.start(when)
    nodes.push(lfo)
  }
  output.connect(destination)
  return {
    input,
    dispose: () => {
      lfo?.stop()
      for (const source of automationSources) source.stop()
      for (const oscillator of modulators) oscillator.stop()
      for (const node of nodes) node.disconnect()
    },
  }
}

export function clipEnvelope(
  time: number,
  duration: number,
  fadeIn = 0,
  fadeOut = 0,
) {
  return Math.max(
    0,
    Math.min(
      1,
      fadeIn > 0 ? time / fadeIn : 1,
      fadeOut > 0 ? (duration - time) / fadeOut : 1,
    ),
  )
}
