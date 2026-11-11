import {useProducerRender} from './use-producer-render'
import {audioActionMessage} from './audio-context-actions'
import { randomUUID } from '@/shared/id'
import { VocalRecordingDialog } from './vocal-recording-dialog'
import { referenceCommands, type ReferenceSnapshot } from './reference-recording'
import type { VocalTake } from '@/audio/vocal-recorder'
import { notifyError } from '@/lib/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Library,
  SlidersHorizontal,
  Mic,
  Square,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { navigate } from '@/lib/navigation'
import { BottomPanel } from '@/components/bottom-panel'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Arrangement } from './arrangement'
import { ProducerComposer } from './producer-composer'
import {selectionContext} from './producer-context'
import { useClipAudioActions } from './clip-audio-actions'
import { ProducerPanel } from './producer-panel'
import { useProducerController } from './use-producer-controller'
import {useProducerVoice} from './use-producer-voice'
import {usePerformanceRecording} from './use-performance-recording'
import {PerformanceRecordingDialog} from './performance-recording-dialog'
import {useProducerPerformance} from './use-producer-performance'
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
  fetchMedia,
} from '@/lib/api'
import { useStudioStore } from '@/stores/studio'
import type { Project, Source, Clip, ProducerCommand } from '@/types/project'

export function StudioPage() {
  const { projectId = '' } = useParams<{projectId:string}>() ?? {},
    queryClient = useQueryClient()
  const params = useSearchParams()
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
  }, [project, projectId, queryClient])
  const [library, setLibrary] = useState(false),
    [editor, setEditor] = useState<string | null>(null),
    [mixer, setMixer] = useState<string | null>(null),
    [exporting, setExporting] = useState(false),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [persisting, setPersisting] = useState(false),
    [saveAsOpen, setSaveAsOpen] = useState(false),
    [height, setHeight] = useState(310)
  const [recording, setRecording] = useState<{ source: Source; clip?: Clip } | null>(null)
  const recordingDirty = useRef(false)
  const onRecordingState = useCallback((dirty: boolean) => { recordingDirty.current = dirty }, [])
  const recordingSave = useRef<{ takeId: string; assetId?: string; commands?: ProducerCommand[]; expectedVersion?: number; requestId: string } | null>(null)
  const [saves] = useState(() => createSaveTracker(setSaving))
  const hasUnsavedChanges = () => performance.isDirty() || recordingDirty.current || !!current.current?.has_unsaved_changes || saves.isSaving() || persisting || !!session.applying || session.sending || session.runs.some(r=>r.status==='running') || !!session.draft.trim() || clipAudio.busy || clipAudio.pending.length>0 || voice.open
  const preparingEdits = useRef(0)
  const saveInFlight = useRef(false)
  const current = useRef(project),
    queue = useRef<Promise<void>>(Promise.resolve())
  current.current = project
  const onError = useCallback((message: string) => { notifyError(message) }, [])
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
  const controller = useProducerController(project, session, setProject)
  const clipAudio = useClipAudioActions(project, audio.engine, setProject, controller.active?.id)
  useProducerRender(project?.id??'',controller,clipAudio)
  const voice=useProducerVoice(project,controller,clipAudio.context,audio.engine)
  const performance=usePerformanceRecording(project,audio.engine,setProject,voice)
  useProducerPerformance(project,controller,performance,voice,audio,{
    save:async plan=>{await persist(plan.save_as,plan.name??undefined);return current.current!.version},
    export:()=>exportWav(true),
  })
  const setAudioContext=clipAudio.setContext
  const setProducerSelection=useCallback((noteIds:string[])=>{
    const p=current.current;if(!p||!editor)return
    const next=selectionContext(p,{clipId:selectedClip??undefined,sourceId:editor,noteIds})
    if(next)setAudioContext(next)
  },[editor,selectedClip,setAudioContext])
  const commit = useCallback(
    (commands: ProducerCommand[], throwOnError = false) => {
      const finishSave = saves.begin()
      const id = projectId
      const run = async () => {
        if (!current.current?.is_draft || current.current.id !== id) return
        setBusy(true)
        audio.engine.stopPart()
        try {
          const result = await applyBatch(id, current.current.version, commands)
          setProject(result.project)
        } catch (e) {
          if (e instanceof ApiError && e.code === 'version_conflict')
            void queryClient.invalidateQueries({ queryKey: ['project', id] })
          if (throwOnError) throw e
          onError(e instanceof Error ? e.message : 'Edit failed')
        } finally {
          setBusy(false)
        }
      }
      queue.current = queue.current.then(run, run)
      return queue.current.finally(finishSave)
    },
    [projectId, setProject, queryClient, audio.engine, saves, onError],
  )
  useEffect(() => {
    if (params?.get('panel') === 'library' || params?.get('panel') === 'sounds')
      setLibrary(true)
  }, [params])
  useEffect(() => {
    setEditor(null)
    setMixer(null)
  }, [projectId])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (recording) return
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
        if(performance.active)performance.stop()
        else useStudioStore.getState().togglePlayback()
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
    if(performance.isDirty())throw new Error('Finish recording and placing the audio before saving.')
    if (saveInFlight.current) throw new Error('A save is already in progress.')
    if (preparingEdits.current || session.applying) throw new Error('Wait for the current upload or import to finish.')
    saveInFlight.current = true
    setPersisting(true)
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
      onError(message)
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
            id: randomUUID(),
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
      trackId = randomUUID()
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
      id: randomUUID(),
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
  async function saveReference(take: VocalTake, snapshot: ReferenceSnapshot) {
    const finishSave = saves.begin()
    const id = projectId
    const attempt = recordingSave.current?.takeId === take.id ? recordingSave.current
      : { takeId: take.id, requestId: randomUUID() } as NonNullable<typeof recordingSave.current>
    recordingSave.current = attempt
    try {
      if (!attempt.assetId) {
        const asset = await uploadAudio(id, new File([take.blob], `${recording?.source.name ?? 'Vocal'}-reference.wav`, { type: 'audio/wav' }), 'reference')
        attempt.assetId = asset.id
      }
      attempt.commands ??= referenceCommands(take, snapshot, attempt.assetId, recording?.source.name ?? 'Vocal')
      const run = async () => {
        const draft = current.current
        if (!draft || draft.id !== id || !draft.is_draft) throw new Error('Reopen the project to save this reference.')
        attempt.expectedVersion ??= draft.version
        try {
          const result = await applyBatch(id, attempt.expectedVersion, attempt.commands!, attempt.requestId)
          setProject(result.project)
        } catch (error) {
          if (error instanceof ApiError && error.code === 'version_conflict') {
            attempt.expectedVersion = undefined
            attempt.requestId = randomUUID()
            await queryClient.invalidateQueries({ queryKey: ['project', id] })
          }
          throw error
        }
      }
      const pending = queue.current.then(run, run)
      queue.current = pending.catch(() => {})
      await pending
    } finally { finishSave() }
  }
  async function exportWav(throwOnError=false) {
    setExporting(true)
    try {
      await audio.exportWav()
    } catch (e) {
      if(throwOnError)throw e
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
              <Button variant="outline" nativeButton={false} render={<a href="/" />}>
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
          onSettings={()=>performance.setSettings(true)}
          recording={performance.active||performance.saving}
        />
      }
      rightPanel={
        <ProducerPanel
          onUndo={()=>void undo()}
          key={project.id}
          session={controller}
          project={project}
          audio={clipAudio}
          voice={voice}
        />
      }
    >
      <ProducerComposer key={project.id} project={project} session={controller} audio={clipAudio} voice={voice}/>
      <PerformanceRecordingDialog recording={performance}/>
      {recording && <VocalRecordingDialog project={project} source={recording.source} clip={recording.clip}
        onClose={() => { recordingDirty.current = false; setRecording(null) }}
        onState={onRecordingState} onSave={saveReference} />}
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
          <Button variant={performance.active?'secondary':'ghost'} size="sm" aria-label={performance.active?'Stop recording':'Record'}
            aria-pressed={performance.active} disabled={performance.saving||(!performance.active&&(performance.failed||!!recording||busy||persisting||saving||controller.sending||!!controller.active))}
            className={performance.active?'text-playback':undefined}
            onClick={()=>performance.active?performance.stop():void performance.record()}>
            {performance.active?<Square/>:performance.saving?<Loader2 className="animate-spin"/>:<Mic/>}
            {performance.active?'Recording':performance.saving?'Saving…':'Record'}
            {performance.phase==='count-in'&&performance.count>0&&<span role="status" aria-label={`Count-in ${performance.count}`} className="tabular-nums">{performance.count}</span>}
          </Button>

          <div className="ml-auto max-w-full">
            <TransportBar
              project={project}
              preparing={audio.preparing}
              recording={performance}
              onMetronome={audio.toggleMetronome}
              onStop={()=>{if(performance.active)performance.stop();else audio.stop()}}
              onTimeSignature={(time_signature) => void commit([{ type: 'project.set_time_signature', time_signature }])}
              onTempo={(tempo) =>
                void commit([{ type: 'project.set_tempo', tempo }])
              }
            />
          </div>
          {busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
        </div>
        <div className="relative flex min-h-0 flex-1">
            <PartLibrary
              open={library}
              engine={audio.engine}
              initialTab={
                params?.get('panel') === 'sounds' ? 'sounds' : undefined
              }
              project={project}
              activeSourceId={editor}
              onOpen={openSource}
              onPlace={(id, track, beat) => void placePart(id, track, beat)}
              onCreate={async (options) => {
                if (options.kind === 'vocal') {
                  const source: Source = { ...emptySource('vocal'), name: options.name, duration: options.duration,
                    vocal: { voice_id: options.voiceId!, language: options.language!, syllables: {}, pitch: [], volume: [], vibrato: {} } }
                  await commit([{ type: 'source.add', source }, { type: 'part.add', part: {
                    id: randomUUID(), name: source.name, source_id: source.id, offset: 0, duration: source.duration,
                  } }])
                  openSource(source.id)
                  return
                }
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
              onUndo={()=>void undo()}
              canUndo={project.can_undo}
              undoPending={busy||saving||persisting||performance.busy}
              audioBusy={clipAudio.busy||!!controller.active||controller.sending}
              onContext={(context, anchor) => clipAudio.target(context, anchor)}
              onAudioAction={(action,context) => {
                if(controller.active||controller.sending||clipAudio.busy)return
                clipAudio.choose(action)
                void controller.sendText(audioActionMessage(action,controller.draft),context??clipAudio.context??undefined)
              }}
              engine={audio.engine}
              project={project}
              commit={commit}
              onSelect={(track, id) => {
                useStudioStore.getState().select(track, id)
                const context=selectionContext(project,{trackId:track,clipId:id})
                if(context)clipAudio.target(context)
                const c = project.document.tracks
                  .find((t) => t.id === track)
                  ?.clips.find((c) => c.id === id)
                if (c?.source_id) openSource(c.source_id)
                else if (c?.asset_id) {
                  const selectedClip = c
                  void (async () => {
                    try {
                      const response = await fetchMedia(
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
              onSeek={(beat)=>{if(!performance.active)audio.seek(beat)}}
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
                        onSelectionChange={setProducerSelection}
                        interactive={interactive}
                        key={source.id}
                        project={project}
                        source={source}
                        clip={clip}
                        engine={audio.engine}
                        commit={commit}
                        onClose={() => setEditor(null)}
                        onRecordReference={() => {
                          if(performance.busy){notifyError('Finish the current recording first.');return}
                          useStudioStore.getState().stop()
                          audio.engine.stop(); audio.engine.stopPart(); audio.engine.stopAudition()
                          setRecording({ source: structuredClone(source), clip: clip ? structuredClone(clip) : undefined })
                        }}
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
