import { expect, it } from 'vitest'
import { sourceSchema } from '@/shared/schema'
import { formatNoteDuration, removeEditorNote, snapNoteDuration } from './note-editing'

it('formats imported fractional durations without changing them and snaps edits to the grid', () => {
  expect(formatNoteDuration(1 / 3)).toBe('0.33 beats')
  expect(formatNoteDuration(2 / 3)).toBe('0.67 beats')
  expect(formatNoteDuration(1.5)).toBe('1.5 beats')
  expect(snapNoteDuration(0.66, 4)).toBe(0.75)
  expect(snapNoteDuration(0, 4)).toBe(0.25)
  expect(snapNoteDuration(4, 1.9)).toBe(1.75)
  expect(snapNoteDuration(1, 0.1)).toBe(0.1)
})
it('deletes one note and its vocal references while clearing orphan continuations', () => {
  const source = sourceSchema.parse({ kind: 'vocal', duration: 4,
    notes: [0, 1, 2, 3].map((start) => ({ id: `n${start}`, pitch: 60, start, duration: 1 })),
    vocal: { voice_id: 'demo', language: 'zh', syllables: {
      n0: { kind: 'syllable', lyric: '音' }, n1: { kind: 'continue' },
      n2: { kind: 'continue' }, n3: { kind: 'syllable', lyric: '乐' },
    }, vibrato: { n0: { rate_hz: 5, depth_cents: 20 } }, pitch: [{ beat: 3, value: 10 }] },
  })
  const before = JSON.stringify(source)
  const patch = removeEditorNote(source, 'n0')
  expect(patch.notes).toEqual(source.notes.slice(1))
  expect(patch.vocal!.syllables).toEqual({ n3: source.vocal!.syllables.n3 })
  expect(patch.vocal!.vibrato).toEqual({})
  expect(patch.vocal!.pitch).toEqual(source.vocal!.pitch)
  expect(JSON.stringify(source)).toBe(before)
})
it('preserves remaining notes on instrumental and drum sources', () => {
  for (const kind of ['notes', 'drums']) {
    const source = sourceSchema.parse({ kind, notes: [{ id: 'a', start: 0, pitch: 60, duration: 1 }, { id: 'b', start: 1, pitch: 62, duration: 1 }] })
    expect(removeEditorNote(source, 'a')).toEqual({ notes: [source.notes[1]] })
  }
})
