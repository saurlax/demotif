import { expect, it } from 'vitest'
import { visibleNoteSegments } from './clip-note-preview'

it('includes sustained notes crossing the left trim and clips both ends to the source window', () => {
  const notes = [
    { id: 'left', start: 0, duration: 3, pitch: 60, velocity: 0.8 },
    { id: 'right', start: 3, duration: 4, pitch: 64, velocity: 0.8 },
    { id: 'outside', start: 5, duration: 1, pitch: 67, velocity: 0.8 },
  ]
  expect(visibleNoteSegments(notes, 2, 3)).toEqual([
    { id: 'left', start: 0, duration: 1, pitch: 60 },
    { id: 'right', start: 1, duration: 2, pitch: 64 },
  ])
  expect(notes[0].start).toBe(0)
})

it('does not draw notes that end exactly at the window start', () => {
  expect(visibleNoteSegments([
    { id: 'before', start: 0, duration: 2, pitch: 36, velocity: 1 },
  ], 2, 4)).toEqual([])
})
