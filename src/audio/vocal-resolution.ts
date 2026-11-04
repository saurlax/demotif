import { vocalScoreError } from '@/lib/vocal-lyrics'
import { cancelVocal, currentVocal, synthesizeVocal } from '@/lib/api'
import { renderProject } from './adapter'
import { audibleTracks } from './model'
import type { Project } from '@/types/project'
import type { VocalRenderStatus } from '@/types/vocal'

type VocalPreparation = {
  synthesize?: boolean
  signal?: AbortSignal
  onProgress?: (stage: string) => void
}

function waitForPoll(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 500)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export async function resolveVocalSource(project: Project, sourceId: string, options: VocalPreparation = {}): Promise<VocalRenderStatus> {
  const source = project.document.sources.find((s) => s.id === sourceId)!
  let ownedRequest: string | undefined
  try {
    options.signal?.throwIfAborted()
    let result = await currentVocal(project.id, sourceId, project.version)
    options.signal?.throwIfAborted()
    if ((!result.current || result.status !== 'ready') && options.synthesize) {
      const scoreError = vocalScoreError(source)
      if (scoreError) throw new Error(scoreError)
      // Reuse an in-flight current score rather than resubmitting on every Play.
      if (!result.current || !['queued', 'running'].includes(result.status)) {
        result = await synthesizeVocal(project.id, sourceId, project.version)
        ownedRequest = result.id
      }
      options.signal?.throwIfAborted()
      while (result.status === 'queued' || result.status === 'running') {
        options.onProgress?.(result.stage ?? result.status)
        await waitForPoll(options.signal)
        result = await currentVocal(project.id, sourceId, project.version)
        options.signal?.throwIfAborted()
      }
    }
    if (!result.current || result.status !== 'ready') {
      throw new Error(`${source.name}: ${result.error || 'synthesize the current vocal score before playback, or mute its track.'}`)
    }
    return result
  } finally {
    if (options.signal?.aborted && ownedRequest) await cancelVocal(project.id, ownedRequest).catch(() => {})
  }
}

export async function resolveVocalProject(project: Project, options: { synthesize?: boolean; signal?: AbortSignal } = {}) {
  const rendered = renderProject(project)
  const audible = new Set(audibleTracks(rendered.tracks).flatMap((t) => t.clips.map((c) => c.assetId)))
  const results: Record<string, VocalRenderStatus> = {}
  for (const source of project.document.sources.filter((s) => s.kind === 'vocal' && audible.has(s.id))) {
    options.signal?.throwIfAborted()
    const result = await resolveVocalSource(project, source.id, options)
    results[source.id] = result
  }
  const ready = renderProject(project, results)
  // Unused sources must not force model inference or media loading during export.
  const used = new Set(audibleTracks(ready.tracks).flatMap((t) => t.clips.map((c) => c.assetId)))
  ready.assets = ready.assets.filter((a) => used.has(a.id))
  return ready
}
