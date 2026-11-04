export function encodeWavBytes(
  channels: Float32Array[],
  rate: number,
): Uint8Array<ArrayBuffer> {
  const frames = channels[0].length,
    count = channels.length,
    bytes = frames * count * 2
  const data = new ArrayBuffer(44 + bytes),
    view = new DataView(data)
  const text = (offset: number, value: string) =>
    [...value].forEach((s, i) => view.setUint8(offset + i, s.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, count, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * count * 2, true)
  view.setUint16(32, count * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, bytes, true)
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < count; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]))
      view.setInt16(
        44 + (frame * count + channel) * 2,
        sample < 0 ? sample * 32768 : sample * 32767,
        true,
      )
    }
  return new Uint8Array(data)
}

export function encodeWav(channels: Float32Array[], rate: number): Blob {
  return new Blob([encodeWavBytes(channels, rate)], { type: 'audio/wav' })
}
