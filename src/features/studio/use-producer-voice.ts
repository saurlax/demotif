import {useEffect,useRef,useState} from 'react';
import {RealtimeVoice,type RealtimeVoicePhase} from '@/audio/realtime-voice';
import {notifyError} from '@/lib/notifications';
import type {Project} from '@/types/project';
import type {AudioContext as MusicalContext} from '@/shared/schema';
import type {useProducerController} from './use-producer-controller';
import {useProducerTurnVoice} from './use-producer-turn-voice';
import {studioClientId} from '@/lib/studio-client';
import type {AudioEngine} from '@/audio/audio';

export function useProducerVoice(project:Project|undefined,session:ReturnType<typeof useProducerController>,context:MusicalContext|null,engine?:AudioEngine){
  const waiters=useRef(new Map<string,{done:()=>void;cancel:()=>void}>());
  const held=useRef(false);
  const drainedRuns=useRef(new Set<string>());
  const callbacks={
    drained:(run:string)=>{drainedRuns.current.add(run);const waiter=waiters.current.get(run);waiters.current.delete(run);waiter?.done()},
    interrupted:()=>{const pending=[...waiters.current.values()];waiters.current.clear();for(const item of pending)item.cancel()},
  };
  const turn=useProducerTurnVoice(project,session,context,callbacks);
  const projectId=project?.id??'';
  const [capabilities,setCapabilities]=useState({projectId:'',realtime:false,turn_based:false});
  const [voiceState,setVoiceState]=useState<{projectId:string;phase:RealtimeVoicePhase}>({projectId:'',phase:'idle'});
  const phase=voiceState.projectId===projectId?voiceState.phase:'idle';
  const resources=useRef<RealtimeVoice|null>(null),latest=useRef({project,session,context});
  useEffect(()=>{latest.current={project,session,context}},[project,session,context]);
  useEffect(()=>{
    if(!projectId)return;
    const request=new AbortController();
    void fetch(`/api/projects/${projectId}/producer/voice/capabilities`,{signal:request.signal}).then(async r=>{if(!r.ok)throw new Error('Cannot check voice availability.');return r.json()}).then(data=>{if(!request.signal.aborted)setCapabilities({projectId,realtime:data.realtime===true,turn_based:data.turn_based===true})}).catch(e=>{if(!request.signal.aborted)notifyError(e)});
    const hidden=()=>{if(document.hidden){resources.current?.close();resources.current=null;}};
    document.addEventListener('visibilitychange',hidden);
    return()=>{request.abort();document.removeEventListener('visibilitychange',hidden);resources.current?.close();resources.current=null;};
  },[projectId]);
  useEffect(()=>{
    if(project)resources.current?.update({type:'demotif.context',version:project.version,context:context?{...context,expected_version:project.version}:null,model:session.model,client_id:studioClientId()});
  },[project,context,session.model]);
  function start(){
    if(held.current){notifyError('Finish recording before starting voice chat.');return;}
    if(engine)void engine.getContext().resume().catch(notifyError);
    if(capabilities.projectId!==projectId)return;
    if(!capabilities.realtime){if(capabilities.turn_based)turn.start();return;}
    const p=latest.current.project;if(!p||resources.current)return;
    const id=p.id;
    const current=()=>latest.current.project?.id===id;
    const voice=new RealtimeVoice({
      phase:next=>{if(current())setVoiceState({projectId:id,phase:next})},
      error:error=>{resources.current=null;if(current())notifyError(error)},
      history:()=>{if(current())void latest.current.session.load().catch(notifyError)},
      project:()=>{if(current())void latest.current.session.refresh().catch(notifyError)},
      ...callbacks,
    });
    resources.current=voice;
    const url=new URL(`/api/projects/${id}/producer/voice/realtime`,window.location.href);url.protocol=window.location.protocol==='https:'?'wss:':'ws:';
    voice.start(url.href,{type:'demotif.context',version:p.version,context:latest.current.context?{...latest.current.context,expected_version:p.version}:null,model:latest.current.session.model,client_id:studioClientId()});
  }
  function end(){resources.current?.close();resources.current=null;turn.end();}
  const labels:Record<RealtimeVoicePhase,string>={idle:'Voice chat',requesting:'Connecting voice…',listening:'Listening…',thinking:'Producer is thinking…',speaking:'Speaking…'};
  const realtimeOpen=phase!=='idle';
  function waitForReply(run:string,done:()=>void,cancel:()=>void){
    if(drainedRuns.current.has(run)){done();return()=>{}}
    waiters.current.set(run,{done,cancel});return()=>{waiters.current.delete(run)};
  }
  return {open:realtimeOpen||turn.open,phase:realtimeOpen?phase:turn.phase,label:realtimeOpen?labels[phase]:turn.label,ready:capabilities.projectId===projectId&&(capabilities.realtime||(capabilities.turn_based&&session.ready)),start,end,waitForReply,recordingResult:(run:string,request:string)=>resources.current?.recordingResult(run,request)??false,hold:(active:boolean)=>{held.current=active;resources.current?.hold(active);turn.hold(active)},interrupt:()=>realtimeOpen?resources.current?.interrupt():turn.interrupt(),finish:()=>realtimeOpen?resources.current?.finish():turn.finish()};
}
