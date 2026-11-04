import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { documentSchema } from '@/shared/schema'
import type { Project } from '@/types/project'
import { resolveVocalProject, resolveVocalSource } from './vocal-resolution'
import { renderSource } from './adapter'
const api = vi.hoisted(() => ({ currentVocal: vi.fn(), synthesizeVocal: vi.fn(), cancelVocal: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), ...api }))
const song = () => ({ id: 'p', name: 'Song', version: 3, document: documentSchema.parse({
  sources: [{ id: 'v', kind: 'vocal', duration: 4, vocal: { voice_id: 'demo', language: 'zh' } }],
  tracks: [{ id: 't', name: 'Vocal', clips: [{ source_id: 'v', length_beats: 4 }] }],
}) }) as Project
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.useRealTimers())
it('never substitutes a piano or stale voice, and allows muted vocal tracks', async () => {
  const p = song()
  expect(renderSource(p.document.sources[0], p.id, 120).kind).toBe('import')
  api.currentVocal.mockResolvedValue({ current: false, status: 'ready', phrases: [] })
  await expect(resolveVocalProject(p)).rejects.toThrow('synthesize')
  api.currentVocal.mockClear()
  p.document.tracks[0].muted = true
  const only = await resolveVocalProject(p)
  expect(only.assets).toEqual([])
  expect(api.currentVocal).not.toHaveBeenCalled()
})
it('resolves current aligned audio using fingerprint-specific IDs and ignores muted vocals', async () => {
  const p = song()
  api.currentVocal.mockResolvedValue({ current: true, status: 'ready', fingerprint: 'abc', phrases: [{ asset_id: 'file', duration_seconds: 2.35, alignment: { offset_seconds: -0.15 } }] })
  const result = await resolveVocalProject(p)
  expect(result.tracks[0].clips[0].assetId).toBe('v:vocal:abc')
  expect(result.tracks[0].clips[0].duration).toBeCloseTo(2.2)
  p.document.tracks[0].clips[0].length_beats = 3
  expect((await resolveVocalProject(p)).tracks[0].clips[0].duration).toBe(1.5)
  expect(result.assets[0].phrases).toEqual([{ url: '/api/projects/p/assets/file/content', offset: -0.15 }])
  api.currentVocal.mockClear(); p.document.tracks[0].muted = true
  expect((await resolveVocalProject(p)).assets).toEqual([])
  expect(api.currentVocal).not.toHaveBeenCalled()
})
it('prepares final output for the captured version and rejects failed or changed results', async () => {
  api.currentVocal.mockResolvedValue({ current: false, status: 'missing', phrases: [] })
  api.synthesizeVocal.mockResolvedValue({ current: false, status: 'failed', error: 'Model unavailable', phrases: [] })
  await expect(resolveVocalProject(song(), { synthesize: true })).rejects.toThrow('Model unavailable')
  expect(api.synthesizeVocal).toHaveBeenCalledWith('p', 'v', 3)
  api.synthesizeVocal.mockResolvedValue({ current: false, status: 'ready', phrases: [] })
  await expect(resolveVocalProject(song(), { synthesize: true })).rejects.toThrow()
})


it('synthesizes a stale clip on explicit playback and waits for the matching result', async () => {
  vi.useFakeTimers()
  api.currentVocal.mockResolvedValueOnce({ current: false, status: 'ready', fingerprint: 'old' })
    .mockResolvedValue({ current: true, status: 'ready', fingerprint: 'new', phrases: [] })
  api.synthesizeVocal.mockResolvedValue({ id: 'request', current: true, status: 'queued' })
  const progress = vi.fn()
  const result = resolveVocalSource(song(), 'v', { synthesize: true, onProgress: progress })
  await vi.advanceTimersByTimeAsync(500)
  expect(await result).toMatchObject({ fingerprint: 'new', current: true, status: 'ready' })
  expect(api.synthesizeVocal).toHaveBeenCalledTimes(1)
  expect(progress).toHaveBeenCalledWith('queued')
  expect(api.cancelVocal).not.toHaveBeenCalled()
})
it('waits for an existing current render without creating or cancelling another subscriber', async () => {
  const controller = new AbortController()
  api.currentVocal.mockResolvedValue({ id: 'manual-request', current: true, status: 'running', stage: 'synthesis' })
  await expect(resolveVocalSource(song(), 'v', { synthesize: true, signal: controller.signal,
    onProgress: () => controller.abort(),
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(api.synthesizeVocal).not.toHaveBeenCalled()
  expect(api.cancelVocal).not.toHaveBeenCalled()
})
it('cancels its own synthesis when playback stops, including a stop during submission', async () => {
  const controller = new AbortController()
  api.currentVocal.mockResolvedValue({ current: false, status: 'missing' })
  api.cancelVocal.mockResolvedValue({ status: 'cancelled' })
  api.synthesizeVocal.mockImplementation(async () => {
    controller.abort()
    return { id: 'owned-request', current: true, status: 'queued' }
  })
  await expect(resolveVocalSource(song(), 'v', { synthesize: true, signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(api.cancelVocal).toHaveBeenCalledWith('p', 'owned-request')
})
it('aborts polling immediately and never returns audio for playback after editor closure', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  api.currentVocal.mockResolvedValue({ current: false, status: 'missing' })
  api.synthesizeVocal.mockResolvedValue({ id: 'owned-request', current: true, status: 'running' })
  api.cancelVocal.mockResolvedValue({ status: 'cancelled' })
  const pending = resolveVocalSource(song(), 'v', { synthesize: true, signal: controller.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1)
  controller.abort()
  await rejected
  expect(api.currentVocal).toHaveBeenCalledTimes(1)
  expect(api.cancelVocal).toHaveBeenCalledWith('p', 'owned-request')
  expect(vi.getTimerCount()).toBe(0)
})

it('accepts unmarked phrase-in-one-note lyrics for synthesis', async () => {
  const project = song(), source = project.document.sources[0]
  source.notes = [{ id: 'legacy-note', pitch: 60, start: 0, duration: 1, velocity: 0.8 }]
  source.vocal!.syllables = { 'legacy-note': { kind: 'syllable', lyric: '我的妈啊' } }
  api.currentVocal.mockResolvedValue({ current: false, status: 'missing' })
  api.synthesizeVocal.mockResolvedValue({ current: true, status: 'ready', phrases: [] })
  await expect(resolveVocalSource(project, source.id, { synthesize: true })).resolves.toMatchObject({ status: 'ready' })
  expect(api.synthesizeVocal).toHaveBeenCalledWith(project.id, source.id, project.version)
})
