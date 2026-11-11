import {z} from 'zod';
import {clientRenderSchema,type ClientRender,documentSchema,newId} from '@/shared/schema';
import type {Store} from './db';
import {ApiError,invalid,missing} from './errors';
import {getProject} from './projects';
import {validateAudioContext,registerRenderedAudio,type AudioRow} from './audio-jobs';

const renderReplySchema=z.object({request_id:z.string().min(1).max(100),client_id:z.string().min(1).max(100),action:z.enum(['claim','complete','fail']),asset_id:z.string().optional()});
function append(db:Store,run:string,event:Record<string,unknown>){db.run('INSERT INTO producer_events (run_id,seq,payload) SELECT ?,COALESCE(MAX(seq),0)+1,? FROM producer_events WHERE run_id=?',run,JSON.stringify(event),run);}
function event(db:Store,run:string,type:string,id:string){
  const row=db.get<{payload:string}>("SELECT payload FROM producer_events WHERE run_id=? AND json_extract(payload,'$.type')=? AND json_extract(payload,'$.request_id')=? ORDER BY seq DESC LIMIT 1",run,type,id);
  return row?JSON.parse(row.payload):undefined;
}
export function validateRender(db:Store,project:string,input:ClientRender){
  const d=validateAudioContext(db,project,input.context),clip=d.tracks.flatMap(t=>t.clips).find(c=>c.id===input.context.clip_id);
  const source=d.sources.find(s=>s.id===(clip?.source_id??input.context.source_id));
  if(!clip&&!source)invalid('Select a Clip or source to render');
  if(input.sound&&(!source||source.kind!=='notes'))invalid('Instrument override requires an instrumental note source');
  return {clip,source};
}
export async function requestBrowserRender(db:Store,project:string,run:string,input:Omit<ClientRender,'request_id'>,emit:(e:Record<string,unknown>)=>void,signal:AbortSignal):Promise<AudioRow>{
  const request=clientRenderSchema.parse({...input,request_id:newId()});validateRender(db,project,request);
  emit({type:'client_render',...request});emit({type:'activity',status:'working',target:request.context,text:'Rendering selected Clip'});
  const deadline=Date.now()+300000;
  while(true){
    signal.throwIfAborted();const result=event(db,run,'client_render_result',request.request_id);
    if(result){if(result.error)invalid('Browser rendering stopped. Keep the original Clip and start a new request.');
      return db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=? AND project_id=?',result.job_id,project)??missing('Rendered result not found');}
    if(Date.now()>deadline)throw new ApiError(408,'render_timeout','Open this project in a browser to render the Clip.');
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},200);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  }
}
export async function completeBrowserRender(db:Store,project:string,runId:string,body:unknown,signal:AbortSignal){
  const input=renderReplySchema.parse(body),run=db.get<{status:string}>('SELECT status FROM producer_runs WHERE id=? AND project_id=?',runId,project)??missing('Producer run not found');
  const found=event(db,runId,'client_render',input.request_id);if(!found)missing('Render request not found');
  const request=clientRenderSchema.parse(found);
  const result=event(db,runId,'client_render_result',input.request_id);if(result)return {status:'complete',job_id:result.job_id};
  if(run.status!=='running')throw new ApiError(409,'render_stopped','Producer is no longer rendering.');
  const claim=event(db,runId,'client_render_claim',input.request_id);
  if(input.action==='claim')return db.tx(()=>{
    validateRender(db,project,request);
    if(claim&&claim.client_id!==input.client_id&&claim.expires>Date.now())return {status:'claimed_elsewhere'};
    append(db,runId,{type:'client_render_claim',request_id:input.request_id,client_id:input.client_id,expires:Date.now()+120000});
    return {status:'claimed'};
  });
  if(!claim||claim.client_id!==input.client_id)throw new ApiError(409,'render_claim','This browser does not own the render request.');
  if(input.action==='fail'){append(db,runId,{type:'client_render_result',request_id:input.request_id,error:true});return {status:'complete'};}
  if(!input.asset_id)invalid('Rendered asset is required');
  // Preserve finished media if the draft changed; acceptance still checks its captured version.
  const job=await registerRenderedAudio(db,project,{asset_id:input.asset_id,name:request.name,context:request.context,reference_only:request.reference_only},signal);
  const current=db.get<{status:string}>('SELECT status FROM producer_runs WHERE id=?',runId);
  if(current?.status!=='running')throw new ApiError(409,'render_stopped','Producer stopped; rendered media is retained for review.');
  return db.tx(()=>{const previous=event(db,runId,'client_render_result',input.request_id);if(previous)return {status:'complete',job_id:previous.job_id};append(db,runId,{type:'client_render_result',request_id:input.request_id,job_id:job.id});return {status:'complete',job_id:job.id};});
}
export function selectedAudioReference(db:Store,project:string,context:ClientRender['context']){
  const d=documentSchema.parse(JSON.parse(getProject(db,project).document)),clip=d.tracks.flatMap(t=>t.clips).find(c=>c.id===context.clip_id),source=d.sources.find(s=>s.id===(context.source_id??clip?.source_id));
  if(!source)return {context,clip};
  const asset=source.asset_id?db.get<{filename:string;kind:string}>('SELECT filename,kind FROM assets WHERE id=? AND project_id=?',source.asset_id,project):undefined;
  return {context,clip,source:{id:source.id,name:source.name,kind:source.kind,asset,notes:source.notes.filter(n=>!context.note_ids?.length||context.note_ids.includes(n.id)),...(source.kind==='notes'?{sound:source.sound,synth:source.synth,sampler:source.sampler}:source.kind==='drums'?{drum_kit:source.drum_kit,drum_samples:source.drum_samples}:source.kind==='vocal'?{vocal:source.vocal}:{})},tempo:d.tempo,time_signature:d.time_signature};
}
