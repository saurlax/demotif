import { expect, it } from 'vitest'
import { sourceSchema } from '@/shared/schema'
import { phraseSources, scoreHash } from './fingerprint'
it('splits at actual rests, preserves continuation groups and ignores source names', () => {
  const source = sourceSchema.parse({ kind: 'vocal', name: 'Singer', duration: 8,
    notes: [{ id: 'a', pitch: 60, start: 0, duration: 1 }, { id: 'b', pitch: 62, start: 1, duration: 1 }, { id: 'c', pitch: 64, start: 4, duration: 1 }],
    vocal: { voice_id: 'demo', language: 'zh', syllables: { a: { kind: 'syllable', lyric: '你' }, b: { kind: 'continue' }, c: { kind: 'syllable', lyric: '好' } } } })
  const parts = phraseSources(source)
  expect(parts.map((p) => p.notes.length)).toEqual([2, 1])
  expect(Object.keys(parts[1].vocal!.syllables)).toEqual(['c'])
  expect(scoreHash(source, 120)).toBe(scoreHash({ ...source, name: 'Changed' }, 120))
  expect(scoreHash(source, 120)).not.toBe(scoreHash(source, 130))
})
