import { useCallback, useEffect, useRef } from 'react'
import {getProject} from '@/lib/api'
import { randomUUID } from '@/shared/id'
import {studioClientId} from '@/lib/studio-client'
import { useErrorToast } from '@/hooks/use-error-toast'
import type { Project } from '@/types/project'
import type { AudioContext } from '@/shared/schema'
import type { useProducerSession, ProducerRun as Run } from './use-producer-session'
export function useProducerController(project:Project|undefined, session:ReturnType<typeof useProducerSession>, onProjectChange:(p:Project)=>void) {
  const {
    runs,
    setRuns,
    setReady,
    setModels,
    setModel,
    model,
    draft,
    setDraft,
    sending,
    setSending,
    error,
    setError,
    setApplying,
    projectRef,
  } = session
  const projectId = project?.id ?? ""
  const base = `/api/projects/${projectId}/producer`
  const load = useCallback(async () => {
    if (!projectId) return
    const r = await fetch(base)
    if (!r.ok) throw new Error('Cannot load producer conversation')
    const data = await r.json()
    if (projectRef.current === projectId) {
      setRuns(data.runs)
      setReady(data.ready)
      setModels(data.models)
      setModel(current=>data.models.some((m:{id:string})=>m.id===current)?current:data.model)
    }
  }, [base, projectId, projectRef, setReady, setRuns,setModels,setModel])
  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load, setError])
  useErrorToast(error, `producer:${projectId}`)
  const active = runs.find((r) => r.status === 'running')
  const activeId = active?.id
  const after = active?.events.at(-1)?.seq ?? 0
  const cursor = useRef(after)
  useEffect(() => {
    cursor.current = after
  }, [after])
  useEffect(() => {
    if (!activeId) return
    const source = new EventSource(
      `${base}/runs/${activeId}/events?after=${cursor.current}`,
    )
    source.onmessage = (e) => {
      const event: import('./use-producer-session').ProducerEvent = JSON.parse(
        e.data,
      )
      if(event.type==='error')setError(event.text??'Producer could not finish')
      if (event.name === 'render_vocal') window.dispatchEvent(new CustomEvent('demotif:vocal-render', { detail: { projectId: projectId } }))
      setRuns((current) =>
        current.map((r) =>
          r.id === activeId && !r.events.some((e) => e.seq === event.seq)
            ? { ...r, events: [...r.events, event] }
            : r,
        ),
      )
    }
    source.addEventListener('done', () => {
      source.close()
      void Promise.all([load(),getProject(projectId).then(p=>{if(projectRef.current===projectId)onProjectChange(p)})]).catch((e) => setError(String(e)))
    })
    return () => source.close()
    // The stream owns its cursor; reconnect uses the last persisted snapshot.
  }, [activeId, base, load, setRuns, setError, projectId, projectRef, onProjectChange])
  async function sendText(message:string,context?:AudioContext,voice=false,expectedVersion=project?.version) {
    if (!project) return
    const text=message.trim()
    if (!text || sending || active) return
    setSending(true)
    setError(null)
    try {
      const id = randomUUID(),
        r = await fetch(`${base}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({id,text,model,voice,client_id:studioClientId(),expected_version:expectedVersion,context:context?{...context,expected_version:expectedVersion}:undefined}),
        })
      if (!r.ok) {
        const body = await r.json()
        throw new Error(body.message ?? 'Producer unavailable')
      }
      if(!voice)setDraft('')
      await load()
      return id
    } catch (e) {
      if(voice)setDraft(text)
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }
  async function send(context?:AudioContext){return sendText(draft,context)}
  async function apply(run: Run) {
    setApplying(run.id)
    setError(null)
    try {
      const r = await fetch(`${base}/runs/${run.id}/apply`, { method: 'POST' })
      if (!r.ok) {
        const body = await r.json()
        throw new Error(body.message ?? 'Apply failed')
      }
      const result = await r.json()
      onProjectChange(result.project)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(null)
    }
  }
  function publicEvents(run: Run) {
    const output: { type: string; text: string; seq: number }[] = []
    for (const e of run.events) {
      if (e.type === 'text') {
        const last = output.at(-1)
        if (last?.type === 'text') last.text += e.delta ?? ''
        else output.push({ type: 'text', text: e.delta ?? '', seq: e.seq })
      } else if (e.type === 'tool')
        output.push({
          type: 'tool',
          text:
            e.name === 'process_audio'
              ? 'Processing audio…'
              : `${e.count ?? 0} edits ${e.status ?? 'proposed'}`,
          seq: e.seq,
        })
      else if (e.type === 'error')
        output.push({
          type: 'error',
          text: e.text ?? 'Run failed',
          seq: e.seq,
        })
      else if (e.type === 'reply' && !output.some((o) => o.type === 'text'))
        output.push({ type: 'text', text: e.text ?? '', seq: e.seq })
    }
    return output
  }

  async function cancel(){if(active)await fetch(`${base}/runs/${active.id}/cancel`,{method:'POST'});await load()}
  async function refresh(){await Promise.all([load(),getProject(projectId).then(p=>{if(projectRef.current===projectId)onProjectChange(p)})])}
  async function continueRecording(run:string,request:string){
    const response=await fetch(`${base}/runs/${run}/recording`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:request,client_id:studioClientId()})});
    if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.message??'Recording is retained; Producer could not continue.');}
    await load();
  }
  return {...session, active, base, load, refresh, send, sendText, continueRecording, apply, cancel, publicEvents}
}
