import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Arrangement } from '@/features/studio/arrangement'
import { ProducerPanel } from '@/features/studio/producer-panel'
import { useProducerSession } from '@/features/studio/use-producer-session'
import { TopBar } from '@/features/studio/top-bar'
import { TransportBar } from '@/features/studio/transport-bar'
import { ApiError, applyCommand, getProject, undoChange } from '@/lib/api'
import { useStudioStore } from '@/stores/studio'
import type { Project, Track } from '@/types/project'

const projectsCrumb = (
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbPage>Projects</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
)

export function StudioPage() {
  const { projectId = '' } = useParams()
  const session = useProducerSession(projectId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const queryKey = ['project', projectId] as const
  const { data: project, isPending, error } = useQuery({
    queryKey,
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
  })

  const playing = useStudioStore((state) => state.playing)
  const bpm = project?.document.tempo ?? 120
  const setProject = (next: Project) => queryClient.setQueryData(queryKey, next)

  const undo = useMutation({
    mutationFn: (current: Project) => undoChange(current.id, current.version),
    onSuccess: (result) => setProject(result.project),
  })

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const delta = (now - previous) / 1000
      previous = now
      const state = useStudioStore.getState()
      state.setPosition(state.positionBeats + (delta * bpm) / 60)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, bpm])

  if (isPending) {
    return (
      <AppShell breadcrumb={projectsCrumb}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Opening project…
        </div>
      </AppShell>
    )
  }

  if (error || !project) {
    return (
      <AppShell breadcrumb={projectsCrumb}>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
          <p className="text-muted-foreground">
            {error instanceof ApiError ? error.message : 'This project could not be loaded.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>
            Back to projects
          </Button>
        </div>
      </AppShell>
    )
  }

  const breadcrumb = (
    <BreadcrumbList>
      <BreadcrumbItem className="hidden md:block">
        <BreadcrumbLink render={<Link to="/" />}>Projects</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="hidden md:block" />
      <BreadcrumbItem>
        <BreadcrumbPage className="max-w-[38vw] truncate">{project.name}</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  )

  async function toggleLock(track: Track) {
    if (!project) return
    const result = await applyCommand(project.id, project.version, {
      type: 'track.set_lock',
      track_id: track.id,
      locked: !track.locked,
    })
    setProject(result.project)
  }

  async function addTrack() {
    if (!project) return
    const result = await applyCommand(project.id, project.version, {
      type: 'track.add',
      name: `Track ${project.document.tracks.length + 1}`,
      kind: 'instrument',
    })
    setProject(result.project)
  }

  return (
    <AppShell breadcrumb={breadcrumb} studio rightPanel={<ProducerPanel key={project.id} session={session}
            project={project}
            onProjectChange={(next) => {
              setProject(next)
              undo.reset()
            }}
          />}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <TopBar
          project={project}
          onUndo={() => undo.mutate(project)}
          undoPending={undo.isPending}
          canUndo={project.can_undo}
        />
        <div className="flex min-h-0 flex-1">
          <Arrangement
            project={project}
            onToggleLock={(track) => void toggleLock(track)}
            onAddTrack={() => void addTrack()}
            onSelect={(trackId, clipId) => useStudioStore.getState().select(trackId, clipId)}
          />

        </div>
        <TransportBar project={project} />
      </div>
    </AppShell>
  )
}
