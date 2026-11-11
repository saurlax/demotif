import { useCallback, useEffect, useRef, useState } from 'react'
import { randomUUID } from '@/shared/id'
import { audioContextSchema, sourceSchema, type AudioContext, type ProducerTarget, type ClientRender } from '@/shared/schema'
import { z } from 'zod'
import { notifyError } from '@/lib/notifications'
import { uploadAudio, mediaUrl } from '@/lib/api'
import { resolveVocalProject } from '@/audio/vocal-resolution'
import {renderProjectSnapshot} from './render-project-snapshot'
import type { AudioEngine } from '@/audio/audio'
import type { Project, ProducerCommand } from '@/types/project'

export const audioJobSchema=z.object({id:z.string(),status:z.string(),name:z.string(),mode:z.string(),applied:z.boolean().default(false),results:z.array(z.object({source:sourceSchema.optional(),transcript:z.object({text:z.string(),words:z.array(z.object({text:z.string(),start:z.number(),end:z.number()}))}).optional(),analysis:z.object({duration:z.number(),notes:z.array(z.object({pitch:z.number(),start:z.number(),duration:z.number(),velocity:z.number()}))}).optional()})),error:z.string().nullable(),request:z.object({reference_only:z.boolean().optional(),context:audioContextSchema.optional(),model:z.string().optional()}).passthrough()})
export type AudioJob=z.infer<typeof audioJobSchema>
export type {AudioAction} from './audio-context-actions'
import type {AudioAction} from './audio-context-actions'
export type ProducerActivity={target:ProducerTarget;text:string;status:string}
export async function studioRequest<T>(url:string,body?:unknown,signal?:AbortSignal):Promise<T>{const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});if(!r.ok){const error=await r.json().catch(()=>null);throw new Error(error?.message??'Request failed')}return r.json()}

export function useClipAudioActions(project:Project|undefined,engine:AudioEngine,onProjectChange:(p:Project)=>void, activeRunId?:string) {
  const [jobs,setJobs]=useState<AudioJob[]>([])
  const [context,setContext]=useState<AudioContext|null>(null),[anchor,setAnchor]=useState<{x:number;y:number}|null>(null)
  const [action,setAction]=useState<AudioAction|null>(null),[busy,setBusy]=useState(false),[activity,setActivity]=useState<ProducerActivity|null>(null)
  const current=useRef(project);useEffect(()=>{current.current=project},[project])
  const operation=useRef<AbortController|null>(null), requestIds=useRef(new Map<string,string>())
  const id=project?.id??'',base=`/api/projects/${id}`
  const load=useCallback(async()=>{if(!id)return;const data=await studioRequest<unknown>(`${base}/audio-jobs`);if(current.current?.id===id)setJobs(z.array(audioJobSchema).parse(data))},[id,base])
  useEffect(()=>{setContext(null);setAnchor(null);setActivity(null);setJobs([]);setAction(null);setBusy(false);return()=>operation.current?.abort()},[id])
  useEffect(()=>{void load().catch(e=>notifyError(String(e)));if(!activeRunId)return;const timer=setInterval(()=>void load().catch(e=>notifyError(String(e))),1200);return()=>clearInterval(timer)},[activeRunId,load])
  const pending=jobs.filter(j=>['submitting','processing','queued'].includes(j.status))
  useEffect(()=>{if(!pending.length||activeRunId)return;let active=true;const timer=setInterval(()=>void load().catch(e=>{if(active){notifyError(String(e));clearInterval(timer)}}),1200);return()=>{active=false;clearInterval(timer)}},[pending.length,load,activeRunId])
  const lastStates=useRef(new Map<string,string>())
  useEffect(()=>{for(const j of jobs){const old=lastStates.current.get(j.id);lastStates.current.set(j.id,j.status);if(old&&old!==j.status){if(j.status==='failed'||j.status==='interrupted'){notifyError(j.error??'Audio processing stopped')}if(j.request.context)setActivity({target:j.request.context as ProducerTarget,status:j.status==='complete'?'proposed':j.status,text:j.status==='complete'?'Audio ready for review':j.status})}}},[jobs])
  function target(next:AudioContext,point?:{x:number;y:number}){setContext(next);if(point)setAnchor(point);setAction(null)}
  function choose(next:AudioAction){setAction(next);setActivity(null)}
  function clearTarget(){setContext(null);setAnchor(null);setAction(null)}
  async function renderCaptured(request:Omit<ClientRender,'request_id'>,signal:AbortSignal){
    const p=current.current;if(!p)throw new Error('Project closed')
    const isolated=renderProjectSnapshot(p,request)
    setBusy(true);setActivity({target:request.context as ProducerTarget,status:'working',text:'Rendering Clip'})
    try{
      const prepared=await resolveVocalProject(isolated.project,{synthesize:true,signal});signal.throwIfAborted()
      const blob=await engine.export(prepared,isolated.seconds);signal.throwIfAborted()
      const asset=await uploadAudio(p.id,new File([blob],`${request.name}.wav`,{type:'audio/wav'}));signal.throwIfAborted()
      if(current.current?.id===p.id)setActivity(null)
      return asset.id
    }catch(error){if(current.current?.id===p.id)setActivity({target:request.context as ProducerTarget,status:'failed',text:signal.aborted?'Render cancelled':'Render failed'});throw error}finally{if(current.current?.id===p.id)setBusy(false)}
  }

  async function cancel(){operation.current?.abort();await Promise.all(pending.map(j=>studioRequest(`${base}/audio-jobs/${j.id}/cancel`,{})));await load();setActivity(null)}
  async function review(job:AudioJob,retarget=false):Promise<ProducerCommand[]> {const p=current.current;if(!p)throw new Error('Project closed');const captured=retarget?(context?{...context,expected_version:p.version}:{expected_version:p.version,track_id:null,clip_id:null,start_beat:0,offset_seconds:0}):job.request.context;if(!captured)throw new Error('Choose a destination');return (await studioRequest<{commands:ProducerCommand[]}>(`${base}/audio-jobs/${job.id}/review`,{context:captured})).commands}
  async function accept(job:AudioJob,retarget=false){const p=current.current;if(!p)return;const captured=retarget?(context?{...context,expected_version:p.version}:{expected_version:p.version,track_id:null,clip_id:null,start_beat:0,offset_seconds:0}):job.request.context;if(!captured)return;setBusy(true);setActivity({target:captured as ProducerTarget,status:'applying',text:'Applying audio Clip'});try{await review(job,retarget);const key=`${job.id}:${JSON.stringify(captured)}`;if(!requestIds.current.has(key))requestIds.current.set(key,randomUUID());const result=await studioRequest<{project:Project}>(`${base}/audio-jobs/${job.id}/accept`,{context:captured,request_id:requestIds.current.get(key)});if(current.current?.id!==p.id)return;onProjectChange(result.project);setAnchor(null);setContext(old=>old?{...old,expected_version:result.project.version}:old);await load();setActivity({target:captured as ProducerTarget,status:'applied',text:'Audio Clip applied'})}catch(e){notifyError(String(e));setActivity({target:captured as ProducerTarget,status:'failed',text:'Apply failed · choose a current destination'})}finally{setBusy(false)}}
  const previewUrl=(job:AudioJob)=>job.results[0]?.source?.asset_id?mediaUrl(id,job.results[0].source.asset_id):undefined
  return {jobs,context,anchor,action,busy,activity,pending,target,choose,renderCaptured,cancel,review,accept,previewUrl,setContext,setAction,setActivity,clearTarget}
}
