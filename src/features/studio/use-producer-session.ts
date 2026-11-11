import { useEffect, useRef, useState } from 'react'
import type { ProducerCommand } from '@/types/project'
import type { ProducerTarget, AudioContext } from '@/shared/schema'
import {producerModels,defaultProducerModel} from '@/shared/producer-models.mjs'
export interface ProducerEvent {
  seq: number
  type: string
  delta?: string
  text?: string
  name?: string
  count?: number
  status?: string
  target?: ProducerTarget
  context?: AudioContext
  model?: string
  request_id?: string
  sound?: import('@/types/project').Source['sound']
  mode?:string
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
    [models,setModels]=useState([...producerModels]),
    [model,setModel]=useState(defaultProducerModel),
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
    setModels([...producerModels])
    setModel(defaultProducerModel)
    setDraft('')
    setSending(false)
    setError(null)
    setApplying(null)
  }
  return {
    runs,
    setRuns,
    ready,
    models,
    setModels,
    model,
    setModel,
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
