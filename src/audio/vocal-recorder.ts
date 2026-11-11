import { randomUUID } from '@/shared/id'
import { encodeWav } from './pcm'
import { recordingBarSeconds } from '@/features/studio/vocal-recording-cues'

export interface VocalTake {
  id: string
  pcm: Float32Array<ArrayBuffer>
  sampleRate: number
  startFrame: number
  duration: number
  interrupted: boolean
  blob: Blob
}
export type RecordingPhase = 'idle' | 'preparing' | 'ready' | 'count-in' | 'recording'
export interface RecorderEvents {
  phase: (phase: RecordingPhase) => void
  progress: (seconds: number) => void
  level: (rms: number) => void
  take: (take: VocalTake) => void
  error: (error: Error) => void
}
export function assembleCapture(blocks: { frame: number; pcm: Float32Array }[], start: number, end: number) {
  const pcm = new Float32Array(Math.max(0, end - start))
  for (const block of blocks) {
    const from = Math.max(start, block.frame), to = Math.min(end, block.frame + block.pcm.length)
    if (to > from) pcm.set(block.pcm.subarray(from - block.frame, to - block.frame), from - start)
  }
  return pcm
}

export class VocalRecorder {
  private generation = 0
  private context?: AudioContext
  private ownsContext=true
  private contextChanged?:()=>void
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private input?: MediaStreamAudioSourceNode
  private clicks: OscillatorNode[] = []
  private frame = 0
  private startFrame = 0
  private endFrame = 0
  private blocks: { frame: number; pcm: Float32Array }[] = []
  private armed = false
  private interrupted = false
  private finished = false
  private events: RecorderEvents
  constructor(events: RecorderEvents) { this.events = events }

  async prepare(deviceId?: string,sharedContext?:AudioContext) {
    this.dispose()
    const generation = this.generation
    this.events.phase('preparing')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording requires HTTPS or localhost and microphone access.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      } })
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return }
      this.stream = stream
      const context = sharedContext??new AudioContext({ latencyHint: 'interactive' })
      this.ownsContext=!sharedContext
      this.context = context
      await context.resume()
      await context.audioWorklet.addModule('/audio/recording-worklet.js')
      if (generation !== this.generation) return
      const node = new AudioWorkletNode(context, 'reference-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      this.node = node
      this.input = context.createMediaStreamSource(stream)
      this.input.connect(node)
      node.connect(context.destination) // worklet emits silence, keeping capture processing alive
      node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return
        if (data.type === 'pcm') this.blocks.push({ frame: data.frame, pcm: data.pcm })
        if (data.type === 'level') this.events.level(data.rms)
        if (data.type === 'done') this.complete(data.frame)
      }
      node.onprocessorerror = () => { this.events.error(new Error('Microphone processing stopped. Your previous take is retained.')); this.stop(true) }
      stream.getAudioTracks().forEach((track) => { track.onended = () => { this.events.error(new Error('Microphone disconnected.')); this.stop(true) } })
      this.contextChanged=() => { if (context.state === 'suspended' && this.armed) this.stop(true) }
      if(this.ownsContext)context.onstatechange=this.contextChanged
      else context.addEventListener?.('statechange',this.contextChanged)
      this.events.phase('ready')
      return true
    } catch (error) {
      if (generation !== this.generation) return
      this.dispose()
      this.events.phase('idle')
      this.events.error(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }
  record(tempo: number, meter: string, duration: number, audible: boolean) {
    const ctx = this.context
    if (!ctx || !this.node || ctx.state !== 'running') throw new Error('Enable your microphone before recording.')
    const bar = recordingBarSeconds(tempo, meter)
    this.recordAt(ctx.currentTime+.1+bar,duration+.25)
    if (audible) {
      const [n] = meter.split('/').map(Number)
      for (let i = 0; i < n; i++) {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain()
        const time = this.startFrame / ctx.sampleRate - bar + i * bar / n
        oscillator.frequency.value = i ? 880 : 1100
        gain.gain.setValueAtTime(.1, time); gain.gain.exponentialRampToValueAtTime(.0001, time + .04)
        oscillator.connect(gain); gain.connect(ctx.destination)
        oscillator.start(time); oscillator.stop(time + .05); this.clicks.push(oscillator)
      }
    }
  }
  recordAt(when:number,duration?:number){
    const ctx=this.context
    if(!ctx||!this.node||ctx.state!=='running')throw new Error('Enable your microphone before recording.')
    if(!Number.isFinite(when)||when<ctx.currentTime)throw new Error('Recording start time is no longer available.')
    this.blocks=[];this.finished=false;this.interrupted=false;this.armed=true
    // Preserve an already sample-aligned time despite floating-point round trips.
    this.startFrame=Math.ceil(when*ctx.sampleRate-1e-7)
    this.endFrame=duration===undefined?Number.MAX_SAFE_INTEGER:this.startFrame+Math.ceil(duration*ctx.sampleRate)
    this.node.port.postMessage({type:'arm',start:this.startFrame,end:this.endFrame})
    this.events.phase('count-in')
    const tick = () => {
      if (!this.armed || !this.context) return
      const seconds = ctx.currentTime - this.startFrame / ctx.sampleRate
      this.events.progress(seconds)
      if (seconds >= 0) this.events.phase('recording')
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }
  stop(interrupted = false) {
    if (!this.armed) { this.dispose(); this.events.phase('idle'); return }
    this.interrupted ||= interrupted
    const ctx = this.context!
    const end = Math.min(this.endFrame, Math.floor(ctx.currentTime * ctx.sampleRate))
    this.node?.port.postMessage({ type: 'stop', frame: end })
    // A suspended/failed processor cannot acknowledge: use only already received frames.
    if (ctx.state !== 'running' || interrupted) {
      const received = this.blocks.at(-1)
      this.complete(Math.min(end, received ? received.frame + received.pcm.length : this.startFrame))
    }
  }
  private complete(end: number) {
    if (!this.armed || this.finished) return
    this.finished = true
    const rate = this.context!.sampleRate, start = this.startFrame, interrupted = this.interrupted
    const received = this.blocks.some((b) => b.frame < end && b.frame + b.pcm.length > start)
    const pcm = received ? assembleCapture(this.blocks, start, Math.max(start, end)) : new Float32Array(0)
    this.dispose()
    this.events.phase('idle'); this.events.level(0)
    if (!pcm.length) return
    this.events.take({ id: randomUUID(), pcm, sampleRate: rate, startFrame: start,
      duration: pcm.length / rate, interrupted, blob: encodeWav([pcm], rate) })
  }
  dispose() {
    this.generation++; this.armed = false
    cancelAnimationFrame(this.frame)
    this.node?.disconnect(); this.node?.port.close(); this.input?.disconnect()
    this.clicks.forEach((osc) => { try { osc.stop() } catch { /* already ended */ } }); this.clicks = []
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop() })
    if (this.context) {
      if(this.ownsContext){this.context.onstatechange=null;void this.context.close().catch(()=>{})}
      else if(this.contextChanged)this.context.removeEventListener?.('statechange',this.contextChanged)
    }
    this.contextChanged=undefined
    this.context = undefined; this.stream = undefined; this.node = undefined; this.input = undefined; this.blocks = []
  }
}
