import {useEffect,useRef} from 'react';
import {studioControlSchema,type RecordingPlan} from '@/shared/studio-control';
import {studioClientId} from '@/lib/studio-client';
import {useStudioStore} from '@/stores/studio';
import {notifyError} from '@/lib/notifications';
import {studioRequest} from './clip-audio-actions';
import type {Project} from '@/types/project';
import type {useProducerController} from './use-producer-controller';
import type {usePerformanceRecording} from './use-performance-recording';
import type {useProducerVoice} from './use-producer-voice';
import type {useAudioSession} from './use-audio-session';

type Work={run:string;abort:AbortController;armed:boolean;preparing:boolean;playing:boolean;drained:boolean;spoken:boolean;unwait?:()=>void};
type FileActions={save:(plan:{save_as:boolean;name:string|null})=>Promise<number>;export:()=>Promise<void>};
export function useProducerPerformance(project:Project|undefined,controller:ReturnType<typeof useProducerController>,recording:ReturnType<typeof usePerformanceRecording>,voice:ReturnType<typeof useProducerVoice>,audio:ReturnType<typeof useAudioSession>,files:FileActions){
  const latest=useRef({project,recording,voice,audio,controller,files});
  useEffect(()=>{latest.current={project,recording,voice,audio,controller,files}},[project,recording,voice,audio,controller,files]);
  const deliveries=useRef(new Map<string,Promise<unknown>>());
  useEffect(()=>recording.subscribe(event=>{
    const control=event.snapshot.control;if(!control)return;
    const {requestId,runId,clientId}=control;
    const previous=deliveries.current.get(requestId)??Promise.resolve();
    const delivery=previous.catch(()=>{}).then(async()=>{
      const response=await studioRequest<{recording?:{track_id:string;clip_id:string;plan:RecordingPlan}}>(`/api/projects/${event.snapshot.projectId}/producer/runs/${runId}/control`,{
        request_id:requestId,client_id:clientId,action:'recording',recording_status:event.status,...(event.duration?{duration:event.duration}:{}),...(event.interrupted?{interrupted:true}:{}),...(event.error?{error:event.error.slice(0,500)}:{}),
      });
      const current=latest.current;
      if(event.status!=='placed'||!response.recording||current.project?.id!==event.snapshot.projectId||document.hidden)return;
      useStudioStore.getState().select(response.recording.track_id,response.recording.clip_id);
      await current.controller.refresh();
      if(latest.current.project?.id!==event.snapshot.projectId||document.hidden)return;
      if(!latest.current.voice.recordingResult(runId,requestId))await latest.current.controller.continueRecording(runId,requestId);
    }).catch(error=>{if(latest.current.project?.id===event.snapshot.projectId)notifyError(error)});
    deliveries.current.set(requestId,delivery);
  }),[recording.subscribe]);
  const work=useRef(new Map<string,Work>());
  useEffect(()=>{
    const tasks=work.current;
    return()=>{for(const task of tasks.values()){task.abort.abort();task.unwait?.();if(task.armed||task.preparing)latest.current.recording.stop();if(task.playing)latest.current.audio.stop()}tasks.clear()};
  },[project?.id]);
  useEffect(()=>{
    const run=controller.active,p=project;
    if(run&&p)for(const event of run.events){
      if(event.type!=='studio_control')continue;
      const parsed=studioControlSchema.safeParse(event);if(!parsed.success)continue;
      const request=parsed.data;
      if(request.client_id!==studioClientId()||work.current.has(request.request_id))continue;
      const completed=run.events.some(e=>e.type==='studio_control_result'&&e.request_id===request.request_id);
      if(completed)continue;
      const task:Work={run:run.id,abort:new AbortController(),armed:false,preparing:false,playing:false,drained:false,spoken:run.events.some(e=>e.type==='input'&&e.mode==='voice')};
      work.current.set(request.request_id,task);
      const endpoint=`/api/projects/${p.id}/producer/runs/${run.id}/control`,body={request_id:request.request_id,client_id:studioClientId()};
      const cancel=()=>{task.abort.abort();task.unwait?.();if(task.armed||task.preparing)latest.current.recording.stop();if(task.playing)latest.current.audio.stop();task.playing=false;task.armed=false;task.preparing=false};
      if(task.spoken&&request.control.action==='prepare_recording')task.unwait=voice.waitForReply(run.id,()=>{task.drained=true;release(task)},cancel);
      void(async()=>{
        try{
          const result=await studioRequest<{status:string}>(endpoint,{...body,action:'claim'},task.abort.signal);
          if(result.status!=='claimed')return;
          task.abort.signal.throwIfAborted();
          const current=latest.current;
          if(current.project?.id!==p.id||current.project.version!==request.expected_version)throw new Error('The project changed. Ask Producer again.');
          const control=request.control;
          let version:number|undefined;
          if(control.action==='metronome'){
            if(current.recording.active)throw new Error('Finish recording before changing the metronome.');
            await current.audio.engine.getContext().resume();
            task.abort.signal.throwIfAborted();
            current.audio.engine.configureMetronome(control.enabled!,current.project.document.tempo,current.project.document.time_signature);
            useStudioStore.getState().setMetronome(control.enabled!);
          }else if(control.action==='play'){task.playing=true;await current.audio.playFrom(control.start_beat);task.playing=false;}
          else if(control.action==='stop'){
            if(current.recording.active)current.recording.stop();else current.audio.stop();
            for(const other of work.current.values())if(other!==task&&other.armed){other.armed=false;other.unwait?.();other.abort.abort()}
          }else if(control.action==='save')version=await current.files.save(control.plan);
          else if(control.action==='export')await current.files.export();
          else if(control.action==='prepare_recording'){
            task.preparing=true;
            if(!await current.recording.prepare({plan:control.plan,control:{requestId:request.request_id,runId:run.id,clientId:request.client_id}}))throw new Error('Microphone preparation was cancelled or unavailable.');
            task.abort.signal.throwIfAborted();task.preparing=false;task.armed=true;
          }
          await studioRequest(endpoint,{...body,action:'complete',...(version?{version}:{})},task.abort.signal);
          release(task);
        }catch(error){
          if(task.abort.signal.aborted)return;
          cancel();const message=error instanceof Error?error.message:'The studio action failed.';notifyError(message);
          await studioRequest(endpoint,{...body,action:'fail',error:message}).catch(()=>{});
        }
      })();
    }
    for(const task of work.current.values()){
      if(task.armed&&recording.phase==='idle'){task.armed=false;task.unwait?.();task.abort.abort();}
      const owner=controller.runs.find(r=>r.id===task.run);
      if(owner&&owner.status!=='running'&&owner.status!=='complete'){
        task.abort.abort();task.unwait?.();if(task.armed||task.preparing)recording.stop();task.armed=false;task.preparing=false;
        if(task.playing){latest.current.audio.stop();task.playing=false;}
      }else release(task);
    }
    function release(task:Work){
      const owner=latest.current.controller.runs.find(r=>r.id===task.run);
      if(!task.armed||owner?.status!=='complete'||task.spoken&&!task.drained||task.abort.signal.aborted)return;
      task.armed=false;task.unwait?.();
      try{latest.current.recording.start()}catch(error){latest.current.recording.stop();notifyError(error)}
    }
  },[controller.active,controller.runs,project,recording,voice]);
}
