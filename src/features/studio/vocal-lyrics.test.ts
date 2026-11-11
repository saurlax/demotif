import { expect, it } from 'vitest'
import { sourceSchema } from '@/shared/schema'
import { applyVocalEntry, vocalEntryPreview, assignVocalLyrics, vocalSyllableError, vocalScoreError, tokenizeVocalLyrics } from '@/lib/vocal-lyrics'
it('accepts Japanese kana readings without Mandarin validation and rejects invalid Japanese overrides', () => {
  expect(vocalSyllableError('境界', 'きょうかい', 'ja')).toBeUndefined()
  expect(vocalSyllableError('境界', 'キョウカイ', 'ja')).toBeUndefined()
  expect(vocalSyllableError('青い空', '', 'ja')).toBeUndefined()
  expect(vocalSyllableError('境界', 'kyoukai', 'ja')).toContain('hiragana or katakana')
})
it('keeps explicit pinyin and phoneme timing when assigning unchanged lyric text', () => {
  const source = sourceSchema.parse({ kind: 'vocal', notes: [{ id: 'a', pitch: 60, start: 0, duration: 1 }, { id: 'b', pitch: 62, start: 1, duration: 1 }],
    vocal: { voice_id: 'demo', language: 'zh', syllables: { a: { kind: 'syllable', lyric: '乐', pronunciation: 'yue', phonemes: [{ symbol: 've', duration_beats: 1 }] }, b: { kind: 'continue' } } } })
  expect(assignVocalLyrics(source, '乐 -').syllables).toEqual(source.vocal!.syllables)
  expect(assignVocalLyrics(source, '好 _').syllables).toEqual({ a: { kind: 'syllable', lyric: '好' }, b: { kind: 'syllable', lyric: '' } })
  expect(() => assignVocalLyrics(source, '乐')).toThrow('2 syllables')
})


it('accepts phrases in a single Chinese note while keeping blank drafts and individual syllables editable', () => {
  expect(vocalSyllableError('我的妈啊')).toBeUndefined()
  expect(vocalSyllableError('ni hao')).toBeUndefined()
  expect(vocalSyllableError('nihao')).toBeDefined()
  for (const lyric of ['', '我', '妈', '啊', 'ni', 'yue', 'shuang']) expect(vocalSyllableError(lyric)).toBeUndefined()
  expect(vocalSyllableError('乐', 'yin yue')).toContain('pinyin syllables')
  expect(vocalSyllableError('乐', 'yue4')).toBeDefined()
  expect(vocalSyllableError('乐', 'yue')).toBeUndefined()
})
it('splits pasted Chinese phrases into note syllables and validates counts before assignment', () => {
  const source = sourceSchema.parse({ kind: 'vocal', duration: 4,
    notes: [0, 1, 2, 3].map((start) => ({ id: `n${start}`, pitch: 60, start, duration: 1 })),
    vocal: { voice_id: 'demo', language: 'zh' } })
  expect(tokenizeVocalLyrics('我的妈啊', 'zh')).toEqual(['我', '的', '妈', '啊'])
  expect(Object.values(assignVocalLyrics(source, '我的妈啊').syllables)).toEqual(
    ['我', '的', '妈', '啊'].map((lyric) => ({ kind: 'syllable', lyric })))
  expect(Object.values(assignVocalLyrics(source, 'wo de ma a').syllables)).toHaveLength(4)
  expect(() => assignVocalLyrics({ ...source, notes: [source.notes[0]] }, '我的妈啊')).toThrow('4 syllables for 1 syllable slot')
  expect(() => assignVocalLyrics(source, 'wo de nihao a')).toThrow('Enter Chinese characters')
})
it('flags previously accepted invalid lyrics by beat before synthesis instead of exposing note UUIDs', () => {
  const source = sourceSchema.parse({ kind: 'vocal', duration: 4, notes: [{ id: 'old-note', start: 2, pitch: 60, duration: 1 }],
    vocal: { voice_id: 'demo', language: 'zh', syllables: { 'old-note': { kind: 'syllable', lyric: 'nihao' } } } })
  expect(vocalScoreError(source)).toMatch(/^Beat 3: Enter Chinese characters/)
  expect(vocalScoreError(source)).not.toContain('old-note')
})


const phraseSource = () => sourceSchema.parse({ kind: 'vocal', duration: 8,
  notes: Array.from({ length: 4 }, (_, start) => ({ id: `n${start}`, pitch: 60 + start, start, duration: 1 })),
  vocal: { voice_id: 'demo', language: 'zh', syllables: {
    n0: { kind: 'syllable', lyric: '我' }, n1: { kind: 'syllable', lyric: '乐', pronunciation: 'yue', phonemes: [{ symbol: 've' }] },
    n2: { kind: 'syllable', lyric: '好', pronunciation: 'hao' }, n3: { kind: 'syllable', lyric: '啊' },
  }, pitch: [{ beat: 0, value: 10 }], vibrato: { n3: { rate_hz: 5, depth_cents: 20 } } } })
it('distributes from the selected note and preserves prefix, unused suffix and unchanged pronunciation', () => {
  const source = phraseSource()
  const patch = applyVocalEntry(source, 'n1', '乐好', { mode: 'across' })
  expect(patch.notes).toBe(source.notes)
  expect(patch.vocal).toEqual(source.vocal)
  const changed = applyVocalEntry(source, 'n1', '音乐', { mode: 'across', pronunciation: 'yin yue' })
  expect(changed.vocal!.syllables.n0).toEqual(source.vocal!.syllables.n0)
  expect(changed.vocal!.syllables.n1).toEqual({ kind: 'syllable', lyric: '音', pronunciation: 'yin' })
  expect(changed.vocal!.syllables.n2).toEqual({ kind: 'syllable', lyric: '乐', pronunciation: 'yue' })
  expect(changed.vocal!.syllables.n3).toEqual(source.vocal!.syllables.n3)
})
it('keeps overflow text available and splits only the selected note on an explicit action', () => {
  const source = phraseSource(), before = JSON.stringify(source)
  expect(vocalEntryPreview(source, 'n3', '我的妈啊', 'across')).toMatchObject({ available: 1, overflow: 3 })
  expect(() => applyVocalEntry(source, 'n3', '我的妈啊', { mode: 'across' })).toThrow('Split the selected note')
  expect(JSON.stringify(source)).toBe(before)
  let sequence = 0
  const patch = applyVocalEntry(source, 'n3', '我的妈啊', { mode: 'across', split: true, newId: () => `split-${++sequence}` })
  const result = sourceSchema.parse({ ...source, ...patch })
  expect(result.notes.slice(0, 3)).toEqual(source.notes.slice(0, 3))
  expect(result.notes.slice(3).map((n) => [n.id, n.start, n.duration, n.pitch])).toEqual([
    ['n3', 3, 0.25, 63], ['split-1', 3.25, 0.25, 63], ['split-2', 3.5, 0.25, 63], ['split-3', 3.75, 0.25, 63],
  ])
  expect(result.vocal!.pitch).toEqual(source.vocal!.pitch)
  expect(result.vocal!.vibrato).toEqual(source.vocal!.vibrato)
  expect(JSON.stringify(source)).toBe(before)
})
it('stores an explicit multiple-syllable assignment without changing note geometry and preserves it in bulk edits', () => {
  const source = phraseSource()
  const patch = applyVocalEntry(source, 'n1', '音乐', { pronunciation: 'yin yue' })
  expect(patch.notes).toBe(source.notes)
  const result = sourceSchema.parse({ ...source, ...patch })
  expect(result.vocal!.syllables.n1).toEqual({ kind: 'syllable', mode: 'multiple', lyric: '音乐', pronunciation: 'yin yue' })
  expect(vocalScoreError(result)).toBeUndefined()
  expect(assignVocalLyrics(result, '我 音乐 好 啊')).toEqual(result.vocal)
  expect(vocalSyllableError('音乐', 'yin', 'zh', 'multiple')).toContain('2 pinyin')
})
it('allows explicitly clearing note pronunciation and phonemes', () => {
  const source = phraseSource()
  const patch = applyVocalEntry(source, 'n1', '乐', { mode: 'across', pronunciation: '', phonemes: undefined })
  expect(patch.vocal!.syllables.n1).toEqual({ kind: 'syllable', lyric: '乐' })
})

it('keeps phrases in the current note by default, including the last note', () => {
  const source = phraseSource()
  for (const id of ['n1', 'n3']) {
    const patch = applyVocalEntry(source, id, '我的妈啊')
    expect(patch.notes).toBe(source.notes)
    expect(patch.vocal!.syllables[id]).toMatchObject({ lyric: '我的妈啊' })
    for (const other of source.notes.filter((n) => n.id !== id))
      expect(patch.vocal!.syllables[other.id]).toEqual(source.vocal!.syllables[other.id])
  }
  expect(applyVocalEntry(source, 'n1', '-').vocal!.syllables.n1).toEqual({ kind: 'continue' })
  expect(applyVocalEntry(source, 'n1', '_').vocal!.syllables.n1).toEqual({ kind: 'syllable', lyric: '' })
})
