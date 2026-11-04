/** Validate the worker's PCM container before it enters the media store. */
export function validateVocalWav(bytes: Buffer, expected: { sample_rate: number; samples: number }) {
  const fail = () => { throw new Error('Worker returned incomplete or invalid audio') }
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail()
  let format = 0, channels = 0, rate = 0, bits = 0, data: Buffer | undefined
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4), start = offset + 8
    if (start + length > bytes.length) fail()
    const name = bytes.toString('ascii', offset, offset + 4)
    if (name === 'fmt ') {
      if (length < 16) fail()
      format = bytes.readUInt16LE(start); channels = bytes.readUInt16LE(start + 2)
      rate = bytes.readUInt32LE(start + 4); bits = bytes.readUInt16LE(start + 14)
    }
    if (name === 'data') data = bytes.subarray(start, start + length)
    offset = start + length + (length % 2)
  }
  if (!data || channels !== 1 || rate !== expected.sample_rate || !((format === 3 && bits === 32) || (format === 1 && bits === 16)) || data.length !== expected.samples * channels * bits / 8) fail()
  if (format === 3) for (let i = 0; i < data!.length; i += 4) if (!Number.isFinite(data!.readFloatLE(i))) fail()
}
