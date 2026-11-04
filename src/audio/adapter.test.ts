import { effectsSchema } from '@/shared/schema'
import { describe, expect, it } from 'vitest'
import { renderProject, emptySource, beatsPerBar } from './adapter'
import type { Project } from '@/types/project'
function project(): Project {
  const source = emptySource()
  source.id = 'notes'
  source.notes = [{ id: 'n', pitch: 60, start: 1, duration: 2, velocity: 0.8 }]
  return {
    id: 'p',
    name: 'Song',
    version: 1,
    can_undo: false,
    is_draft: false, draft_base_id: null, draft_base_version: null, draft_example_id: null, has_unsaved_changes: false,
    created_at: '',
    updated_at: '',
    document: {
      tempo: 120,
      time_signature: '4/4',
      key: null,
      sections: [],
      parts: [],
      sources: [
        source,
        {
          ...emptySource('audio'),
          id: 'audio',
          asset_id: 'file',
          duration: 10,
        },
      ],
      mixer: {
        master: {
          id: 'master',
          name: 'Master',
          gain: 1,
          bus_id: null,
          effects: effectsSchema.parse({}),
          automation: [
            { parameter: 'gain', points: [{ time: 4, value: 0.5 }] },
          ],
          automation_bypassed: false,
        },
        buses: [],
      },
      tracks: [
        {
          id: 't',
          name: 'Track',
          kind: 'instrument',
          color: null,
          muted: false,
          solo: false,
          locked: false,
          gain: 1,
          bus_id: null,
          effects: effectsSchema.parse({}),
          clips: [
            {
              id: 'c',
              name: 'Notes',
              kind: 'midi',
              start_beat: 4,
              length_beats: 4,
              asset_id: null,
              source_id: 'notes',
              offset: 2,
              source_duration: 4,
              gain: 1,
              fade_in: 1,
              fade_out: 1,
              envelope_offset: 0,
              envelope_duration: null,
              locked: false,
              color: null,
            },
            {
              id: 'a',
              name: 'Audio',
              kind: 'audio',
              start_beat: 8,
              length_beats: 8,
              asset_id: null,
              source_id: 'audio',
              offset: 1,
              source_duration: 4,
              gain: 1,
              fade_in: 0.5,
              fade_out: 0.5,
              envelope_offset: 0,
              envelope_duration: null,
              locked: false,
              color: null,
            },
          ],
        },
      ],
    },
  }
}
describe('accepted music to audio adapter', () => {
  it('converts beats exactly once and preserves recorded source seconds across tempo changes', () => {
    const p = project(),
      rendered = renderProject(p)
    expect(rendered.assets[0].notes![0]).toMatchObject({
      start: 0.5,
      duration: 1,
      pitch: 60,
    })
    expect(rendered.tracks[0].clips[0]).toMatchObject({
      start: 2,
      offset: 1,
      duration: 2,
      fadeIn: 0.5,
    })
    expect(rendered.tracks[0].clips[1]).toMatchObject({
      start: 4,
      offset: 1,
      duration: 4,
      fadeIn: 0.5,
    })
    p.document.tempo = 90
    const slower = renderProject(p)
    expect(slower.assets[0].notes![0].duration).toBeCloseTo(4 / 3)
    expect(slower.tracks[0].clips[1]).toMatchObject({
      offset: 1,
      duration: 4,
      fadeIn: 0.5,
    })
    expect(slower.mixer!.master.automation![0].points[0].time).toBeCloseTo(
      8 / 3,
    )
  })
  it('does not invent notes and derives bar lengths from the actual signature', () => {
    expect(emptySource().notes).toEqual([])
    expect(beatsPerBar('3/4')).toBe(3)
    expect(beatsPerBar('6/8')).toBe(3)
  })
})
