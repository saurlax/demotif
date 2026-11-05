// Also imported by unit tests: gate by absolute audio frames, never UI timers.
export function captureWindow(frame, length, start, end) {
  const from = Math.max(frame, start), to = Math.min(frame + length, end)
  return to > from ? { offset: from - frame, length: to - from, frame: from } : null
}
if (typeof AudioWorkletProcessor !== 'undefined') {
  class ReferenceCapture extends AudioWorkletProcessor {
    constructor() {
      super()
      this.start = Infinity
      this.end = Infinity
      this.finished = false
      this.port.onmessage = ({ data }) => {
        if (data.type === 'arm') { this.start = data.start; this.end = data.end }
        if (data.type === 'stop') {
          this.end = Math.min(this.end, data.frame)
          this.finish(Math.min(currentFrame, this.end))
        }
      }
    }
    finish(frame) {
      if (this.finished) return
      this.finished = true
      this.port.postMessage({ type: 'done', frame })
    }
    process(inputs) {
      if (this.finished) return false
      const channels = inputs[0], input = channels?.[0]
      if (input) {
        const mono = new Float32Array(input.length)
        for (const c of channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length
        let sum = 0
        for (const sample of mono) sum += sample * sample
        // Level updates are real measurements, throttled to about 20Hz.
        if (currentFrame % 2048 === 0) this.port.postMessage({ type: 'level', rms: Math.sqrt(sum / mono.length) })
        const region = captureWindow(currentFrame, mono.length, this.start, this.end)
        if (region) {
          const pcm = mono.slice(region.offset, region.offset + region.length)
          this.port.postMessage({ type: 'pcm', frame: region.frame, pcm }, [pcm.buffer])
        }
      }
      if (currentFrame + 128 >= this.end) this.finish(this.end)
      // Outputs stay zero: microphone monitoring is deliberately disconnected.
      return !this.finished
    }
  }
  registerProcessor('reference-capture', ReferenceCapture)
}
