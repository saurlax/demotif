import { useEffect, useRef, useState } from 'react'
import type { ProducerCommand } from '@/types/project'
export interface ProducerEvent {
  seq: number
  type: string
  delta?: string
  text?: string
  name?: string
  count?: number
  status?: string
}
export interface ProducerRun {
  id: string
  prompt: string
  status: string
  base_version: number
  applied: boolean
  commands: ProducerCommand[]
  events: ProducerEvent[]
}
export function useProducerSession(projectId: string) {
  const [runs, setRuns] = useState<ProducerRun[]>([]),
    [ready, setReady] = useState(false),
    [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [applying, setApplying] = useState<string | null>(null)
  const projectRef = useRef(projectId)
  const [activeProject, setActiveProject] = useState(projectId)
  useEffect(() => {
    projectRef.current = projectId
  }, [projectId])
  if (activeProject !== projectId) {
    setActiveProject(projectId)
    setRuns([])
    setReady(false)
    setDraft('')
    setSending(false)
    setError(null)
    setApplying(null)
  }
  return {
    runs,
    setRuns,
    ready,
    setReady,
    draft,
    setDraft,
    sending,
    setSending,
    error,
    setError,
    applying,
    setApplying,
    projectRef,
  }
}
