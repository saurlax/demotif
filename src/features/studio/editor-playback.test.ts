import { describe, expect, it } from 'vitest'
import { emptySource, renderClip } from '@/audio/adapter'
import { editorPlaybackClip } from './editor-playback'

describe('editor playback range', () => {
  it.each(['notes', 'drums', 'vocal'] as const)('loops all 32 beats of a %s source opened from a four-bar instance', (kind) => {
    const source = { ...emptySource(kind), duration: 32 }
    const clip = {
      ...editorPlaybackClip(source, 156),
      start_beat: 16, length_beats: 16, source_duration: 16,
      offset: 8, fade_out: 8, envelope_duration: 16, envelope_offset: 4,
    }
    const preview = editorPlaybackClip(source, 156, clip)
    expect(renderClip(preview, source, 156)).toMatchObject({
      offset: 0, duration: 32 * 60 / 156, fadeOut: 0, envelopeOffset: 0,
      envelopeDuration: undefined,
    })
    expect(clip).toMatchObject({ offset: 8, source_duration: 16, fade_out: 8 })
  })

  it('retains the trimmed audio window and envelope', () => {
    const source = { ...emptySource('audio'), duration: 32 }
    const clip = { ...editorPlaybackClip(source, 120), offset: 4, source_duration: 8, fade_out: 2 }
    expect(editorPlaybackClip(source, 120, clip)).toBe(clip)
    expect(renderClip(clip, source, 120)).toMatchObject({ offset: 4, duration: 8, fadeOut: 2 })
  })
})
