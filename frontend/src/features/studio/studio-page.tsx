import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Library,
  Upload,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BottomPanel } from '@/components/bottom-panel'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Arrangement } from './arrangement'
import { ProducerPanel } from './producer-panel'
import { useProducerSession } from './use-producer-session'
import { ProjectMenu } from './project-menu'
import { StudioHeaderActions } from './studio-header-actions'
import { TransportBar } from './transport-bar'
import { PartEditor } from './part-editor'
import type { CreateClipOptions } from './create-clip-dialog'
import { PartLibrary } from './part-library'
import { MixerPanel } from './mixer-panel'
import { createSaveTracker } from './save-status'
import { useAudioSession } from './use-audio-session'
import { emptySource } from '@/audio/adapter'
import {
  ApiError,
  applyBatch,
  openProject,
  saveDraft,
  undoChange,
  uploadAudio,
  mediaUrl,
} from '@/lib/api'
import { useStudioStore } from '@/stores/studio'
import type { Project, Source, ProducerCommand } from '@/types/project'

export function StudioPage() {
  const { projectId = '' } = useParams(),
    queryClient = useQueryClient()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useProducerSession(projectId)
  const {
    data: project,
    isPending,
    error,
  } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => openProject(projectId),
    gcTime: 0, retry: false, refetchOnWindowFocus: false,
    enabled: !!projectId,
  })
  useEffect(() => {
    if (project && !project.is_draft && project.id === projectId) {
      // Upgrade an already-open/cached saved-project view into an isolated draft too.
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    } else if (project && project.id !== projectId) {
      queryClient.setQueryData(['project', project.id], project)
      navigate(`/studio/${project.id}`, { replace: true })
    }
  }, [project, projectId, queryClient, navigate])
  const [notice, setNotice] = useState<string | null>(null),
    [library, setLibrary] = useState(false),
    [editor, setEditor] = useState<string | null>(null),
    [mixer, setMixer] = useState<string | null>(null),
    [exporting, setExporting] = useState(false),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [persisting, setPersisting] = useState(false),
    [saveAsOpen, setSaveAsOpen] = useState(false),
    [height, setHeight] = useState(310)
  const [saves] = useState(() => createSaveTracker(setSaving))
  const hasUnsavedChanges = () => !!current.current?.has_unsaved_changes || saves.isSaving() || persisting || !!session.applying
  const preparingEdits = useRef(0)
  const saveInFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null),
    current = useRef(project),
    queue = useRef<Promise<void>>(Promise.resolve())
  current.current = project
  const onError = useCallback((message: string) => setNotice(message), [])
  const audio = useAudioSession(project, onError)
  const selectedClip = useStudioStore((s) => s.selectedClipId)
  const source = project?.document.sources.find((s) => s.id === editor)
  const clip = project?.document.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === selectedClip && c.source_id === editor)
  const setProject = useCallback(
    (next: Project) => {
      current.current = next
      queryClient.setQueryData(['project', next.id], next)
    },
    [queryClient],
  )
  const commit = useCallback(
    (commands: ProducerCommand[]) => {
      const finishSave = saves.begin()
      const id = projectId
      const run = async () => {
        if (!current.current?.is_draft || current.current.id !== id) return
        setNotice(null)
        setBusy(true)
        audio.engine.stopPart()
        try {
          const result = await applyBatch(id, current.current.version, commands)
          setProject(result.project)
        } catch (e) {
          setNotice(e instanceof Error ? e.message : 'Edit failed')
          if (e instanceof ApiError && e.code === 'version_conflict')
            void queryClient.invalidateQueries({ queryKey: ['project', id] })
        } finally {
          setBusy(false)
        }
      }
      queue.current = queue.current.then(run, run)
      return queue.current.finally(finishSave)
    },
    [projectId, setProject, queryClient, audio.engine, saves],
  )
  useEffect(() => {
    if (params.get('panel') === 'library' || params.get('panel') === 'sounds')
      setLibrary(true)
  }, [params])
  useEffect(() => {
    setEditor(null)
    setMixer(null)
    setNotice(null)
  }, [projectId])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // The save buttons handle Save as for example drafts; regular drafts support Cmd/Ctrl+S.
        e.preventDefault()
        if (!e.shiftKey && current.current?.draft_base_id && !current.current.draft_example_id) {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          void persist(false).catch((error) => onError(String(error)))
        } else setSaveAsOpen(true)
        return
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLButtonElement
      )
        return
      if (e.code === 'Space') {
        e.preventDefault()
        useStudioStore.getState().togglePlayback()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        void undo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  async function undo() {
    const finishSave = saves.begin()
    const run = async () => {
      const draft = current.current
      if (!draft?.is_draft || draft.id !== projectId) return
      setProject((await undoChange(draft.id, draft.version)).project)
    }
    queue.current = queue.current.then(run, run)
    await queue.current.catch((error) => onError(String(error))).finally(finishSave)
  }
  async function persist(saveAs: boolean, name?: string) {
    if (saveInFlight.current) throw new Error('A save is already in progress.')
    if (preparingEdits.current || session.applying) throw new Error('Wait for the current upload or import to finish.')
    saveInFlight.current = true
    setPersisting(true)
    setNotice(null)
    const run = async () => {
      const draft = current.current
      if (!draft?.is_draft || draft.id !== projectId) throw new Error('The draft is still opening.')
      const result = await saveDraft(draft.id, draft.version, saveAs, name)
      setProject(result.project)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
    // Later edits wait behind this save and remain dirty when they are accepted.
    queue.current = queue.current.then(run, run)
    try {
      await queue.current
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'version_conflict'
        ? 'The project changed in another tab. Your draft is intact; use Save as to keep a separate copy.'
        : error instanceof Error ? error.message : 'Could not save the project.'
      setNotice(message)
      if (error instanceof ApiError && error.code === 'version_conflict')
        void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      throw new Error(message)
    } finally {
      saveInFlight.current = false
      setPersisting(false)
    }
  }
  function openSource(id: string) {
    setEditor(id)
    setMixer(null)
    if (window.innerWidth < 768) setLibrary(false)
  }
  async function addPreset(presetId: string, asInstrument: boolean, options?: CreateClipOptions) {
    const finishSave = saves.begin()
    preparingEdits.current++
    try {
      const response = await fetch(`/api/projects/${projectId}/sounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id: presetId,
          as_instrument: asInstrument,
        }),
      })
      if (!response.ok) throw new Error('Could not load sound')
      const source: Source = await response.json()
      if (options) {
        source.name = options.name
        if (options.kind !== 'audio') source.duration = options.duration
      }
      await commit([
        { type: 'source.add', source },
        {
          type: 'part.add',
          part: {
            id: crypto.randomUUID(),
            name: source.name,
            source_id: source.id,
            offset: 0,
            duration: source.duration,
          },
        },
      ])
      if (!current.current?.document.sources.some((item) => item.id === source.id)) return false
      openSource(source.id)
      return true
    } catch (e) {
      onError(String(e))
      return false
    } finally {
      preparingEdits.current--
      finishSave()
    }
  }
  async function placePart(
    partId: string,
    target?: string,
    beat = useStudioStore.getState().positionBeats,
  ) {
    const p = current.current,
      part = p?.document.parts.find((p) => p.id === partId)
    if (!p || !part) return
    const source = p.document.sources.find((s) => s.id === part.source_id)!,
      commands: ProducerCommand[] = []
    let trackId = target ?? p.document.tracks.find((t) => !t.locked)?.id
    if (!trackId) {
      trackId = crypto.randomUUID()
      commands.push({
        type: 'track.add',
        id: trackId,
        name: part.name,
        kind:
          source.kind === 'drums'
            ? 'drums'
            : source.kind === 'audio'
              ? 'audio'
              : 'instrument',
      })
    }
    commands.push({
      type: 'clip.add',
      id: crypto.randomUUID(),
      track_id: trackId,
      name: part.name,
      kind: source.kind === 'audio' ? 'audio' : 'midi',
      source_id: source.id,
      start_beat: beat,
      length_beats:
        source.kind === 'audio'
          ? (part.duration * p.document.tempo) / 60
          : part.duration,
      offset: part.offset,
      source_duration: part.duration,
    })
    await commit(commands)
  }
  async function importFiles(files: FileList | null) {
    if (!files) return
    const id = projectId
    const finishSave = saves.begin()
    preparingEdits.current++
    setBusy(true)
    try {
      if (files.length > 8) throw new Error('Import up to 8 files at once')
      for (const file of Array.from(files)) {
        if (file.size > 60 * 1024 * 1024)
          throw new Error('Audio files must be smaller than 60 MB')
        const buffer = await audio.engine.import(file)
        if (buffer.duration > 300)
          throw new Error('Audio files must be shorter than 5 minutes')
        const asset = await uploadAudio(id, file),
          source = {
            ...emptySource('audio'),
            name: file.name.replace(/\.[^.]+$/, ''),
            asset_id: asset.id,
            duration: buffer.duration,
          }
        const part = {
          id: crypto.randomUUID(),
          name: source.name,
          source_id: source.id,
          offset: 0,
          duration: source.duration,
        }
        await commit([
          { type: 'source.add', source },
          { type: 'part.add', part },
        ])
        await placePart(part.id)
        openSource(source.id)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Audio import failed')
    } finally {
      setBusy(false)
      preparingEdits.current--
      finishSave()
      if (input.current) input.current.value = ''
    }
  }
  async function exportWav() {
    setExporting(true)
    try {
      await audio.exportWav()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }
  const crumbs = (
    <BreadcrumbList className="flex-nowrap">
      {project && (
        <BreadcrumbItem className="min-w-0">
          {project.is_draft && project.id === projectId ? (
            <ProjectMenu project={project} saving={persisting} busy={saving || !!session.applying}
              exporting={exporting} onSave={() => void persist(false).catch((error) => onError(error.message))}
              onSaveAs={(name) => persist(true, name)} onExport={() => void exportWav()}
              saveAsOpen={saveAsOpen} onSaveAsOpenChange={setSaveAsOpen} />
          ) : <BreadcrumbPage className="truncate">{project.name}</BreadcrumbPage>}
        </BreadcrumbItem>
      )}
    </BreadcrumbList>
  )
  if (isPending || !project || !project.is_draft || project.id !== projectId)
    return (
      <AppShell studio breadcrumb={crumbs}>
        <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
          {error ? (
            <>
              <span>{error.message}</span>
              <Button variant="outline" render={<a href="/" />}>
                Projects
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-4 animate-spin" />
              Opening project…
            </>
          )}
        </div>
      </AppShell>
    )
  return (
    <AppShell
      studio
      breadcrumb={crumbs}
      hasUnsavedChanges={hasUnsavedChanges}
      headerActions={
        <StudioHeaderActions
          saving={persisting}
          dirty={project.has_unsaved_changes}
          example={!!project.draft_example_id || !project.draft_base_id}
          onUndo={() => void undo()}
          undoPending={busy}
          canUndo={project.can_undo}
        />
      }
      rightPanel={
        <ProducerPanel
          key={project.id}
          session={session}
          project={project}
          onProjectChange={setProject}
        />
      }
    >
      <div className="studio-daw flex h-full min-h-0 flex-col overflow-hidden">
        <div className="studio-toolbar flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
          <Button
            variant={library ? 'secondary' : 'ghost'}
            size="sm"
            data-library-drop="true"
            aria-pressed={library}
            onClick={() => setLibrary(!library)}
          >
            <Library />
            Library
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <Upload />
            Audio
          </Button>
          <Button
            aria-pressed={!!mixer}
            variant={mixer ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setMixer(mixer ? null : 'master')
              setEditor(null)
            }}
          >
            <SlidersHorizontal />
            Mixer
          </Button>
          <div className="ml-auto max-w-full">
            <TransportBar
              project={project}
              preparing={audio.preparing}
              onTimeSignature={(time_signature) => void commit([{ type: 'project.set_time_signature', time_signature }])}
              onTempo={(tempo) =>
                void commit([{ type: 'project.set_tempo', tempo }])
              }
            />
          </div>
          {busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
          <input
            ref={input}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => void importFiles(e.target.files)}
          />
        </div>
        {notice && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <span className="flex-1">{notice}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss error"
              onClick={() => setNotice(null)}
            >
              <X />
            </Button>
          </div>
        )}
        <div className="relative flex min-h-0 flex-1">
            <PartLibrary
              open={library}
              engine={audio.engine}
              initialTab={
                params.get('panel') === 'sounds' ? 'sounds' : undefined
              }
              project={project}
              activeSourceId={editor}
              onOpen={openSource}
              onPlace={(id, track, beat) => void placePart(id, track, beat)}
              onCreate={async (options) => {
                if (!await addPreset(options.presetId, options.kind === 'notes', options))
                  throw new Error('Could not create clip. Please try again.')
              }}
              onRemove={(id) =>
                void commit([{ type: 'part.remove', part_id: id }])
              }
              onClose={() => setLibrary(false)}
              onPreset={(id, instrument) => void addPreset(id, instrument)}
            />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Arrangement
              engine={audio.engine}
              project={project}
              commit={commit}
              onSelect={(track, id) => {
                useStudioStore.getState().select(track, id)
                const c = project.document.tracks
                  .find((t) => t.id === track)
                  ?.clips.find((c) => c.id === id)
                if (c?.source_id) openSource(c.source_id)
                else if (c?.asset_id) {
                  const selectedClip = c
                  void (async () => {
                    try {
                      const response = await fetch(
                        mediaUrl(project.id, selectedClip.asset_id!),
                      )
                      if (!response.ok) throw new Error('Audio unavailable')
                      const buffer = await audio.engine.import(
                        new File([await response.blob()], selectedClip.name),
                      )
                      const source = {
                        ...emptySource('audio'),
                        name: selectedClip.name,
                        asset_id: selectedClip.asset_id,
                        duration: buffer.duration,
                      }
                      await commit([
                        { type: 'source.add', source },
                        {
                          type: 'clip.update',
                          track_id: track,
                          clip_id: id,
                          source_id: source.id,
                          source_duration:
                            selectedClip.source_duration ??
                            (selectedClip.length_beats * 60) /
                              project.document.tempo,
                        },
                      ])
                      openSource(source.id)
                    } catch (e) {
                      onError(String(e))
                    }
                  })()
                }
              }}
              onSeek={audio.seek}
              onTrack={(id) => {
                setMixer(id)
                setEditor(null)
              }}
              onPlace={(id, track, beat) => void placePart(id, track, beat)}
            />
            <BottomPanel open={!!(source || mixer)} height={Math.min(height, window.innerHeight * 0.48) + 6}>
              {(interactive) => <>
                <div
                  role="separator"
                  aria-label="Resize editor"
                  className="h-1.5 shrink-0 cursor-row-resize bg-muted hover:bg-border"
                  onPointerDown={(e) => {
                    const y = e.clientY,
                      h = height
                    const move = (e: PointerEvent) =>
                      setHeight(
                        Math.max(
                          160,
                          Math.min(window.innerHeight - 260, h + y - e.clientY),
                        ),
                      )
                    const end = () => {
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', end)
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', end, { once: true })
                  }}
                />
                <div className="min-h-0 flex-1">
                  {mixer ? (
                    <MixerPanel
                      key={mixer}
                      project={project}
                      commit={commit}
                      initialId={mixer}
                      onClose={() => setMixer(null)}
                    />
                  ) : (
                    source && (
                      <PartEditor
                        interactive={interactive}
                        key={source.id}
                        project={project}
                        source={source}
                        clip={clip}
                        engine={audio.engine}
                        commit={commit}
                        onClose={() => setEditor(null)}
                        onError={onError}
                      />
                    )
                  )}
                </div>
              </>}
            </BottomPanel>
          </div>
        </div>

      </div>
    </AppShell>
  )
}
