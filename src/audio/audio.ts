import { audibleTracks, BPM } from './model'
import type { Asset, Clip, Note, Project } from './model'
import { partRange } from './sequence'
import { AudioRenderer } from './audioRenderer'

import { renderVoice, SYNTH_RATE as RATE } from './voices'
import { clipEnvelope, createMaster, createTrackBus } from './effects'
import { createMixGraph } from './mixGraph'
import type { TrackEffects } from './model'
export { synthesize } from './voices'

export class AudioEngine {
  private context?: AudioContext
  private buffers = new Map<string, AudioBuffer>()
  private rendered = new Map<string, { asset: Asset; buffer: AudioBuffer }>()
  private renderedLimit = 64
  private sources: AudioBufferSourceNode[] = []
  private startedAt = 0
  private from = 0
  private pendingFrom: number | null = null
  private generation = 0
  private liveDisposers: (() => void)[] = []
  private loading = new Map<string, Promise<void>>()
  private media = new Map<string, AudioBuffer>()
  private mediaLoading = new Map<string, Promise<AudioBuffer>>()
  private renderer = new AudioRenderer()
  private rendering = new WeakMap<Asset, Promise<AudioBuffer>>()
  private renderTargets = new Map<string, Asset>()
  private loadGeneration = 0
  // A song can contain hundreds of recorded Parts. Release the previous
  // project's PCM, including late decode results, when switching projects.
  release() {
    this.loadGeneration++
    this.buffers.clear()
    this.rendered.clear()
    this.renderedLimit = 64
    this.loading.clear()
    this.media.clear()
    this.mediaLoading.clear()
    this.renderer.reset()
    this.rendering = new WeakMap()
    this.renderTargets.clear()
  }
  private previewSource?: AudioBufferSourceNode
  private previewGain?: GainNode
  private previewGeneration = 0
  private partGeneration = 0
  private partLoop?: {
    source: AudioBufferSourceNode
    gain: GainNode
    startedAt: number
    from: number
    length: number
    bpm: number
    dispose: () => void
  }
  hasBuffer(id: string) {
    return this.buffers.has(id)
  }
  sampleDuration(asset: Asset, pitch?: number) {
    const row = asset.drumSamples?.find((row) => row.pitch === pitch)
    return this.buffers.get(
      row ? `${asset.id}:drum:${row.pitch}:${row.url}` : asset.id,
    )?.duration
  }
  async prepare(assets: Asset[]) {
    const generation = this.loadGeneration
    const sources = assets.flatMap((a) =>
      a.drumSamples?.length
        ? a.drumSamples.map((row) => ({
            ...a,
            id: `${a.id}:drum:${row.pitch}:${row.url}`,
            url: row.url,
            drumSamples: undefined,
          }))
        : [a],
    )
    const queue = sources.filter(
      (asset) => asset.url && !this.buffers.has(asset.id),
    )
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let asset = queue.shift(); asset; asset = queue.shift()) {
          if (generation !== this.loadGeneration) return
          let loading = this.loading.get(asset.id)
          if (!loading) {
            const id = asset.id
            const url = asset.url!
            let decoded = this.mediaLoading.get(url)
            if (!decoded)
              decoded = this.media.has(url)
                ? Promise.resolve(this.media.get(url)!)
                : fetch(url)
                    .then((response) => {
                      if (!response.ok)
                        throw new Error(`无法载入 ${asset.name}`)
                      return response.arrayBuffer()
                    })
                    .then((data) => this.getContext().decodeAudioData(data))
                    .then((buffer) => {
                      if (generation === this.loadGeneration)
                        this.media.set(url, buffer)
                      return buffer
                    })
            this.mediaLoading.set(url, decoded)
            loading = decoded
              .then((buffer) => {
                if (generation === this.loadGeneration) this.store(id, buffer)
              })
              .finally(() => {
                if (this.loading.get(id) === loading) this.loading.delete(id)
                if (this.mediaLoading.get(url) === decoded)
                  this.mediaLoading.delete(url)
              })
            this.loading.set(asset.id, loading)
          }
          await loading
        }
      }),
    )
  }
  getContext() {
    return (this.context ??= new AudioContext({ latencyHint: 'interactive' }))
  }
  buffer(asset: Asset): AudioBuffer {
    if (asset.kind === 'import') {
      const imported = this.buffers.get(asset.id)
      if (imported) return imported
      throw new Error('导入音频已失效，请重新导入。')
    }
    this.renderTargets.set(asset.id, asset)
    const existing = this.rendered.get(asset.id)
    if (existing?.asset === asset) return existing.buffer
    const samples = renderVoice(asset, this.voiceSource(asset))
    const buffer = new AudioBuffer({
      numberOfChannels: samples.right ? 2 : 1,
      length: samples.pcm.length,
      sampleRate: RATE,
    })
    buffer.copyToChannel(samples.pcm, 0)
    if (samples.right) buffer.copyToChannel(samples.right, 1)
    this.rendered.set(asset.id, { asset, buffer })
    if (this.rendered.size > this.renderedLimit)
      this.rendered.delete(this.rendered.keys().next().value!)
    return buffer
  }
  private voiceSource(asset: Asset): import('./voices').SamplePCM | undefined {
    const pcm = (buffer: AudioBuffer) => ({
      data: buffer.getChannelData(0),
      right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : undefined,
      rate: buffer.sampleRate,
    })
    if (asset.drumSamples?.length)
      return {
        data: new Float32Array(0),
        rate: RATE,
        drums: Object.fromEntries(
          asset.drumSamples.map((row) => {
            const buffer = this.buffers.get(
              `${asset.id}:drum:${row.pitch}:${row.url}`,
            )
            if (!buffer) throw new Error(`采样尚未载入：${row.name}`)
            return [row.pitch, pcm(buffer)]
          }),
        ),
      }
    if (asset.sampler) {
      const buffer = this.buffers.get(asset.id)
      if (!buffer) throw new Error('采样尚未载入')
      return pcm(buffer)
    }
    return undefined
  }
  async import(file: File): Promise<AudioBuffer> {
    return this.getContext().decodeAudioData(await file.arrayBuffer())
  }
  store(id: string, buffer: AudioBuffer) {
    this.rendered.delete(id)
    this.buffers.set(id, buffer)
  }
  private render(asset: Asset): Promise<AudioBuffer> {
    if (asset.kind === 'import') return Promise.resolve(this.buffer(asset))
    this.renderTargets.set(asset.id, asset)
    const cached = this.rendered.get(asset.id)
    if (cached?.asset === asset) return Promise.resolve(cached.buffer)
    const pending = this.rendering.get(asset)
    if (pending) return pending
    const generation = this.loadGeneration
    let source: import('./voices').SamplePCM | undefined
    try {
      source = this.voiceSource(asset)
    } catch (error) {
      return Promise.reject(error)
    }
    const pendingRender = this.renderer
      .run({ kind: 'synth', asset, source })
      .then((result) => {
        if (generation !== this.loadGeneration)
          throw new DOMException('音频任务已取消', 'AbortError')
        if (!('pcm' in result)) throw new Error('音频计算结果无效')
        const buffer = new AudioBuffer({
          numberOfChannels: result.right ? 2 : 1,
          length: result.pcm.length,
          sampleRate: RATE,
        })
        buffer.copyToChannel(result.pcm, 0)
        if (result.right) buffer.copyToChannel(result.right, 1)
        // An older edited version may finish after a newer one. Never let it
        // evict the current source; undo can still request that version later.
        if (this.renderTargets.get(asset.id) === asset)
          this.rendered.set(asset.id, { asset, buffer })
        if (this.rendered.size > this.renderedLimit)
          this.rendered.delete(this.rendered.keys().next().value!)
        return buffer
      })
      .finally(() => {
        if (this.rendering.get(asset) === pendingRender)
          this.rendering.delete(asset)
      })
    this.rendering.set(asset, pendingRender)
    return pendingRender
  }
  async audition(asset: Asset, note: Note) {
    this.stopAudition()
    const generation = this.previewGeneration
    const ctx = this.getContext()
    if (ctx.state !== 'running') await ctx.resume()
    if (generation !== this.previewGeneration) return
    if ((asset.sampler && asset.url) || asset.drumSamples?.length)
      await this.prepare([asset])
    if (generation !== this.previewGeneration) return
    const duration = Math.min(1.5, Math.max(0.4, note.duration))
    const samples = renderVoice(
      { ...asset, duration, notes: [{ ...note, start: 0, duration }] },
      this.voiceSource(asset),
    )
    const buffer = ctx.createBuffer(
      samples.right ? 2 : 1,
      samples.pcm.length,
      RATE,
    )
    buffer.copyToChannel(samples.pcm, 0)
    if (samples.right) buffer.copyToChannel(samples.right, 1)
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = 0.5
    source.buffer = buffer
    source.connect(gain)
    gain.connect(ctx.destination)
    this.previewSource = source
    this.previewGain = gain
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      if (this.previewSource === source) {
        this.previewSource = undefined
        this.previewGain = undefined
      }
    }
    source.start()
  }
  async auditionAudio(asset: Asset) {
    this.stopAudition()
    const generation = this.previewGeneration,
      ctx = this.getContext()
    if (ctx.state !== 'running') await ctx.resume()
    if (generation !== this.previewGeneration) return
    await this.prepare([asset])
    if (generation !== this.previewGeneration) return
    const buffer = this.buffers.get(asset.id)
    if (!buffer) throw new Error('采样尚未载入')
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      duration = Math.min(3, buffer.duration)
    source.buffer = buffer
    source.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.01)
    gain.gain.setValueAtTime(
      0.55,
      ctx.currentTime + Math.max(0.01, duration - 0.04),
    )
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration)
    this.previewSource = source
    this.previewGain = gain
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      if (this.previewSource === source) {
        this.previewSource = undefined
        this.previewGain = undefined
      }
    }
    const startedAt = ctx.currentTime
    source.start(startedAt, 0, duration)
    return { startedAt, duration, sourceDuration: buffer.duration }
  }
  stopAudition() {
    this.previewGeneration++
    if (this.previewSource && this.context) {
      const time = this.context.currentTime
      this.previewGain?.gain.cancelScheduledValues(time)
      this.previewGain?.gain.setValueAtTime(this.previewGain.gain.value, time)
      this.previewGain?.gain.linearRampToValueAtTime(0, time + 0.012)
      this.previewSource.stop(time + 0.012)
    }
    this.previewSource = undefined
    this.previewGain = undefined
  }
  async playPart(
    asset: Asset,
    clip: Clip,
    volume: number,
    bpm = BPM,
    effects: TrackEffects = {},
    mix?: { project: Project; trackId: string },
  ) {
    const range = partRange(clip)
    const previous = this.partLoop
    const ratio = asset.kind === 'import' ? 1 : (previous?.bpm ?? bpm) / bpm
    const phase =
      previous &&
      Math.abs(previous.from * ratio - range.start) < 1e-6 &&
      Math.abs(previous.length * ratio - range.length) < 1e-6
        ? (Math.max(0, this.getContext().currentTime - previous.startedAt) %
            previous.length) *
          ratio
        : 0
    this.stopPart()
    const generation = this.partGeneration
    const ctx = this.getContext()
    if (ctx.state !== 'running') await ctx.resume()
    if (generation !== this.partGeneration) return false
    if (asset.url || asset.drumSamples?.length) await this.prepare([asset])
    if (generation !== this.partGeneration) return false
    const buffer = await this.render(asset)
    if (generation !== this.partGeneration) return false
    // decodeAudioData resamples recorded WAVs to the hardware rate; rounding
    // can shorten their source window by one output frame.
    if (
      range.length <= 0 ||
      range.end > buffer.duration + Math.max(1e-6, 1 / buffer.sampleRate)
    )
      throw new Error('Part 超出音频范围')
    const source = ctx.createBufferSource()
    const track = mix?.project.tracks.find((t) => t.id === mix.trackId)
    const graph = mix
      ? createMixGraph(
          ctx,
          ctx.destination,
          mix.project,
          clip.start + phase,
          ctx.currentTime,
          { start: clip.start, length: range.length, phase },
        )
      : null
    const master = graph ? null : createMaster(ctx, ctx.destination)
    const bus = graph
      ? null
      : createTrackBus(
          ctx,
          master!.input,
          volume,
          effects,
          bpm,
          phase,
          ctx.currentTime,
        )
    const input = graph
      ? graph.track(track!.id, volume, effects, track!.busId)
      : bus!.input
    const gain = ctx.createGain()
    const envelope = ctx.createBufferSource()
    const envelopeRate = 3000
    const envelopeBuffer = ctx.createBuffer(
      1,
      Math.max(1, Math.ceil(range.length * envelopeRate)),
      envelopeRate,
    )
    const values = envelopeBuffer.getChannelData(0)
    for (let i = 0; i < values.length; i++) {
      values[i] =
        (clip.gain ?? 1) *
        clipEnvelope(
          i / envelopeRate + (clip.envelopeOffset ?? 0),
          clip.envelopeDuration ?? range.length,
          clip.fadeIn ?? 0,
          clip.fadeOut ?? 0,
        )
    }
    envelope.buffer = envelopeBuffer
    envelope.loop = true
    envelope.loopEnd = range.length
    gain.gain.value = 0
    envelope.connect(gain.gain)
    envelope.start(ctx.currentTime, phase)
    source.buffer = buffer
    source.loop = true
    source.loopStart = range.start
    source.loopEnd = Math.min(range.end, buffer.duration)
    source.connect(gain)
    gain.connect(input)
    source.start(ctx.currentTime, range.start + phase)
    this.partLoop = {
      source,
      gain,
      from: range.start,
      length: range.length,
      bpm,
      startedAt: ctx.currentTime - phase,
      dispose: () => {
        envelope.stop()
        envelope.disconnect()
        graph?.dispose()
        bus?.dispose()
        master?.dispose()
      },
    }
    return true
  }
  partPosition() {
    const current = this.partLoop
    return current
      ? Math.max(0, this.getContext().currentTime - current.startedAt) %
          current.length
      : null
  }
  stopPart() {
    this.partGeneration++
    this.partLoop?.source.stop()
    this.partLoop?.source.disconnect()
    this.partLoop?.gain.disconnect()
    this.partLoop?.dispose()
    this.partLoop = undefined
  }
  position() {
    return (
      this.pendingFrom ??
      this.from +
        (this.context
          ? Math.max(0, this.context.currentTime - this.startedAt)
          : 0)
    )
  }
  stop() {
    this.generation++
    this.pendingFrom = null
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
    this.sources = []
    for (const dispose of this.liveDisposers) dispose()
    this.liveDisposers = []
  }
  async play(project: Project, from: number) {
    this.stopPart()
    this.stopAudition()
    this.stop()
    const generation = this.generation
    this.pendingFrom = from
    const ctx = this.getContext()
    const used = new Set(
      audibleTracks(project.tracks).flatMap((track) =>
        track.clips
          .filter((clip) => clip.start + clip.duration > from)
          .map((clip) => clip.assetId),
      ),
    )
    await Promise.all([
      ctx.resume(),
      this.prepare(project.assets.filter((asset) => used.has(asset.id))),
    ])
    if (generation !== this.generation) return
    this.renderedLimit = Math.max(64, used.size)
    await Promise.all(
      project.assets
        .filter((asset) => used.has(asset.id))
        .map((asset) => this.render(asset)),
    )
    if (generation !== this.generation) return
    this.from = from
    this.startedAt = ctx.currentTime + 0.15
    this.pendingFrom = null
    this.schedule(project, ctx, ctx.destination, from, this.startedAt, true)
  }
  private schedule(
    project: Project,
    ctx: BaseAudioContext,
    destination: AudioNode,
    from: number,
    when: number,
    live = false,
  ) {
    const graph = createMixGraph(ctx, destination, project, from, when)
    const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
    if (live) this.liveDisposers.push(graph.dispose)
    for (const track of audibleTracks(project.tracks)) {
      const input = graph.track(
        track.id,
        track.gain,
        track.effects,
        track.busId,
      )
      for (const clip of track.clips) {
        if (clip.start + clip.duration <= from) continue
        const asset = assets.get(clip.assetId)
        if (!asset) continue
        const source = ctx.createBufferSource()
        source.buffer = this.buffer(asset)
        const clipGain = ctx.createGain()
        source.connect(clipGain)
        clipGain.connect(input)
        const elapsed = Math.max(0, from - clip.start)
        const duration = Math.min(
          clip.duration - elapsed,
          source.buffer.duration - clip.offset - elapsed,
        )
        if (duration <= 0) continue
        const clipWhen = when + Math.max(0, clip.start - from)
        const level = clip.gain ?? 1
        const fadeIn = clip.fadeIn ?? 0,
          fadeOut = clip.fadeOut ?? 0
        const envelopeDuration = clip.envelopeDuration ?? clip.duration
        const envelopeOffset = clip.envelopeOffset ?? 0
        clipGain.gain.setValueAtTime(
          level *
            clipEnvelope(
              elapsed + envelopeOffset,
              envelopeDuration,
              fadeIn,
              fadeOut,
            ),
          clipWhen,
        )
        const points = [fadeIn, envelopeDuration - fadeOut, envelopeDuration]
          .map((point) => point - envelopeOffset)
          .filter((point) => point > elapsed && point <= elapsed + duration)
          .sort((a, b) => a - b)
        for (const point of points)
          clipGain.gain.linearRampToValueAtTime(
            level *
              clipEnvelope(
                point + envelopeOffset,
                envelopeDuration,
                fadeIn,
                fadeOut,
              ),
            clipWhen + point - elapsed,
          )
        // A short terminal ramp also avoids clicks on arbitrary trimmed sources.
        if (!fadeOut) {
          clipGain.gain.setValueAtTime(
            level,
            clipWhen + Math.max(0, duration - 0.008),
          )
          clipGain.gain.linearRampToValueAtTime(0, clipWhen + duration)
        }
        source.start(clipWhen, clip.offset + elapsed, duration)
        if (live) {
          this.sources.push(source)
          source.onended = () => {
            source.disconnect()
            clipGain.disconnect()
            this.sources = this.sources.filter((s) => s !== source)
          }
        }
      }
    }
  }
  async export(project: Project, duration: number): Promise<Blob> {
    this.renderedLimit = Math.max(64, project.assets.length)
    await this.prepare(project.assets)
    await Promise.all(project.assets.map((asset) => this.render(asset)))
    const ctx = new OfflineAudioContext(
      2,
      Math.ceil(
        (duration +
          ([
            ...project.tracks,
            ...(project.mixer?.buses ?? []),
            ...(project.mixer ? [project.mixer.master] : []),
          ].some((t) => t.effects?.reverb || t.effects?.delay)
            ? 2.2
            : 0)) *
          44100,
      ),
      44100,
    )
    this.schedule(project, ctx, ctx.destination, 0, 0)
    const buffer = await ctx.startRendering()
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (
        let i = Math.floor(duration * buffer.sampleRate);
        i < data.length;
        i++
      )
        data[i] *= Math.max(0, 1 - (i / buffer.sampleRate - duration) / 2.2)
    }
    const result = await this.renderer.run({
      kind: 'wav',
      channels: Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i),
      ),
      rate: buffer.sampleRate,
    })
    if (!('wav' in result)) throw new Error('WAV 编码结果无效')
    return new Blob([result.wav], { type: 'audio/wav' })
  }
}

export { encodeWav } from './pcm'

export function waveform(
  buffer: AudioBuffer,
  offset: number,
  duration: number,
  bars = 120,
): number[] {
  const data = buffer.getChannelData(0),
    start = Math.floor(offset * buffer.sampleRate)
  const stride = Math.max(1, Math.floor((duration * buffer.sampleRate) / bars))
  return Array.from({ length: bars }, (_, i) => {
    let peak = 0
    for (let n = 0; n < stride; n += 12)
      peak = Math.max(peak, Math.abs(data[start + i * stride + n] ?? 0))
    return Math.min(1, peak * 2.3)
  })
}
