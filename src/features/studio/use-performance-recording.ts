import {useCallback,useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {PerformanceRecording} from '@/audio/performance-recording';
import type {AudioEngine} from '@/audio/audio';
import type {VocalTake,RecordingPhase} from '@/audio/vocal-recorder';
import type {CountIn} from '@/audio/performance-timing';
import {resolveVocalProject} from '@/audio/vocal-resolution';
import {randomUUID} from '@/shared/id';
import {applyBatch,getProject,uploadAudio,ApiError} from '@/lib/api';
import {notifyError} from '@/lib/notifications';
import {useStudioStore} from '@/stores/studio';
import type {Project,ProducerCommand} from '@/types/project';
import type {useProducerVoice} from './use-producer-voice';
import {performanceCommands,type PerformanceSnapshot} from './performance-placement';
import {recordingPlanSchema,recordingIds,type RecordingPlan,type RecordingControl,type RecordingStatus} from '@/shared/studio-control';
import {renderProject} from '@/audio/adapter';

export type PerformanceEvent={status:RecordingStatus;snapshot:PerformanceSnapshot;duration?:number;interrupted?:boolean;error?:string};

type Pending={take:VocalTake;snapshot:PerformanceSnapshot;assetId?:string;commands?:ProducerCommand[];requestId:string;expectedVersion:number};
export function usePerformanceRecording(project:Project|undefined,engine:AudioEngine,onProject:(project:Project)=>void,voice:ReturnType<typeof useProducerVoice>){
  const [phase,setPhase]=useState<RecordingPhase>('idle'),[saving,setSaving]=useState(false),[failed,setFailed]=useState(false);
  const [countIn,setCountIn]=useState<CountIn>('four'),[device,setDevice]=useState(''),[level,setLevel]=useState(0),[count,setCount]=useState(0);
  const [settings,setSettings]=useState(false);
  const latest=useRef({project,onProject,voice,countIn,device});
  useEffect(()=>{latest.current={project,onProject,voice,countIn,device}},[project,onProject,voice,countIn,device]);
  const pending=useRef<Pending|null>(null),snapshot=useRef<PerformanceSnapshot|null>(null),generation=useRef(0),phaseRef=useRef<RecordingPhase>('idle'),savingRef=useRef(false),mounted=useRef(true);
  const listeners=useRef(new Set<(event:PerformanceEvent)=>void>()),capturedRequests=useRef(new Set<string>()),scheduledRequests=useRef(new Set<string>());
  const subscribe=useCallback((listener:(event:PerformanceEvent)=>void)=>{listeners.current.add(listener);return()=>{listeners.current.delete(listener)}},[]);
  function publish(status:RecordingStatus,item=snapshot.current,extra:Partial<PerformanceEvent>={}){
    if(!item?.control)return;
    if(status==='scheduled')scheduledRequests.current.add(item.control.requestId);
    if(status==='cancelled'&&!scheduledRequests.current.has(item.control.requestId))return;
    for(const listener of listeners.current)listener({status,snapshot:item,...extra});
  }
  const [recorder]=useState(()=>new PerformanceRecording(engine,{
    phase:next=>{
      const previous=phaseRef.current;phaseRef.current=next;useStudioStore.getState().setPerformance(next!=='idle');
      if(next==='idle')latest.current.voice.hold(false);
      if(next!==previous){
        if(next==='count-in')publish('scheduled');if(next==='recording')publish('recording');
        if(next==='idle'&&previous!=='idle'){const item=snapshot.current;queueMicrotask(()=>{if(item?.control&&!capturedRequests.current.has(item.control.requestId))publish('cancelled',item)})}
        if(mounted.current)setPhase(next);
      }
    },
    level:rms=>{if(mounted.current)setLevel(rms)},
    progress:seconds=>{
      const captured=snapshot.current;if(!captured)return;
      const interval=latest.current.countIn==='four'?60/captured.tempo:60/captured.tempo*4/Number(captured.meter.split('/')[1]);
      const maximum=latest.current.countIn==='four'?4:latest.current.countIn==='bar'?Number(captured.meter.split('/')[0]):0;
      if(mounted.current)setCount(seconds<0?Math.min(maximum,Math.max(1,Math.ceil(-seconds/interval))):0);
      useStudioStore.getState().setPosition(captured.origin+Math.max(0,seconds)*captured.tempo/60);
    },
    take:take=>{
      const captured=snapshot.current;if(!captured)return;
      if(captured.control)capturedRequests.current.add(captured.control.requestId);
      pending.current={take,snapshot:captured,requestId:captured.control?recordingIds(captured.control.requestId).receipt_id:randomUUID(),expectedVersion:captured.version};
      publish('captured',captured,{duration:take.duration,interrupted:take.interrupted});
      if(mounted.current)void save();
    },
    error:error=>notifyError(error),
  }));
  useEffect(()=>{
    mounted.current=true;
    if(snapshot.current&&snapshot.current.projectId!==project?.id){pending.current=null;snapshot.current=null;setFailed(false)}
    const hidden=()=>{if(document.hidden)stop(true)};
    document.addEventListener('visibilitychange',hidden);
    return()=>{mounted.current=false;generation.current++;document.removeEventListener('visibilitychange',hidden);recorder.dispose();latest.current.voice.hold(false)};
  },[recorder,project?.id]);
  useEffect(()=>{
    if(snapshot.current&&project&&snapshot.current.projectId===project.id&&snapshot.current.version!==project.version&&phaseRef.current!=='idle'){
      stop(true);notifyError('The project changed. Recording stopped; captured audio is retained.');
    }
  },[project,recorder]);
  function download(){
    const item=pending.current;if(!item)return;
    const url=URL.createObjectURL(item.take.blob),link=document.createElement('a');link.href=url;link.download=`${item.snapshot.name}.wav`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function save(){
    const item=pending.current;if(!item||savingRef.current)return;
    savingRef.current=true;if(mounted.current){setSaving(true);setFailed(false)}
    try{
      if(!item.assetId)item.assetId=(await uploadAudio(item.snapshot.projectId,new File([item.take.blob],`${item.snapshot.name}.wav`,{type:'audio/wav'}),'recording')).id;
      item.commands??=performanceCommands(item.take,item.snapshot,item.assetId);
      const result=await applyBatch(item.snapshot.projectId,item.expectedVersion,item.commands,item.requestId);
      if(latest.current.project?.id===item.snapshot.projectId)latest.current.onProject(result.project);
      if(pending.current===item)pending.current=null;
      publish('placed',item.snapshot,{duration:item.take.duration,interrupted:item.take.interrupted});
    }catch(error){
      if(mounted.current)setFailed(true);
      publish('failed',item.snapshot,{error:error instanceof Error?error.message:'Recording placement failed.'});
      if(error instanceof ApiError&&error.code==='version_conflict')void getProject(item.snapshot.projectId).then(p=>{if(latest.current.project?.id===p.id)latest.current.onProject(p)}).catch(()=>{});
      toast.error(error instanceof Error?error.message:'Recording could not be placed.',{id:`recording:${item.take.id}`,duration:Infinity,action:{label:'Retry',onClick:()=>void save()},cancel:{label:'Download WAV',onClick:download}});
    }finally{savingRef.current=false;if(mounted.current)setSaving(false)}
  }
  async function prepare(options?:{countIn?:CountIn;origin?:number;plan?:RecordingPlan;control?:RecordingControl}){
    const p=latest.current.project;if(!p?.is_draft)throw new Error('Open an editing draft before recording.');
    if(pending.current||savingRef.current)throw new Error('Finish saving or download the previous recording before recording again.');
    if(phaseRef.current!=='idle')throw new Error('A recording is already being prepared.');
    const epoch=++generation.current;
    const plan=options?.plan?recordingPlanSchema.parse(options.plan):undefined;
    if(plan?.target.kind==='existing_track'){
      const targetId=plan.target.track_id,target=p.document.tracks.find(track=>track.id===targetId);
      if(!target||target.kind!=='audio'||target.locked)throw new Error('Choose an unlocked audio track before recording.');
    }
    const state=useStudioStore.getState(),origin=plan?.start_beat??options?.origin??state.positionBeats;
    snapshot.current={projectId:p.id,version:p.version,origin,tempo:p.document.tempo,meter:p.document.time_signature,name:plan?.name??`Recording ${p.document.tracks.filter(t=>t.kind==='audio').length+1}`,plan,control:options?.control};
    const countIn=plan?.count_in??options?.countIn;
    if(countIn){setCountIn(countIn);latest.current={...latest.current,countIn}}
    state.setPerformance(true);state.setPlaying(false);engine.stopPart();engine.stopAudition();
    phaseRef.current='preparing';setPhase('preparing');
    try{
      await engine.getContext().resume();
      const prepared=plan&&!plan.accompaniment?renderProject(p):await resolveVocalProject(p);
      if(epoch!==generation.current)return false;
      const duration=plan?(plan.end_beat-plan.start_beat)*60/p.document.tempo:undefined;
      const ready=await recorder.prepare(prepared,origin*60/p.document.tempo,latest.current.device||undefined,plan?.accompaniment??true,duration);
      if(!ready&&epoch===generation.current){recorder.dispose();useStudioStore.getState().setPerformance(false);phaseRef.current='idle';setPhase('idle')}
      return ready;
    }catch(error){recorder.dispose();useStudioStore.getState().setPerformance(false);phaseRef.current='idle';setPhase('idle');throw error}
  }
  function start(){
    const captured=snapshot.current;if(!captured||latest.current.project?.id!==captured.projectId||latest.current.project.version!==captured.version)throw new Error('The project changed. Prepare recording again.');
    latest.current.voice.hold(true);
    const duration=captured.plan?(captured.plan.end_beat-captured.plan.start_beat)*60/captured.tempo:undefined;
    try{recorder.start(captured.tempo,captured.meter,latest.current.countIn,duration)}catch(error){latest.current.voice.hold(false);recorder.dispose();throw error}
  }
  async function record(){try{if(await prepare())start()}catch(error){notifyError(error)}}
  function stop(interrupted=false){
    generation.current++;
    const preparing=phaseRef.current==='preparing';recorder.stop(interrupted);
    if(preparing){phaseRef.current='idle';useStudioStore.getState().setPerformance(false);setPhase('idle');publish('cancelled')}
  }
  return {phase,saving,failed,level,count,settings,setSettings,countIn,setCountIn,device,setDevice,prepare,start,record,stop,subscribe,retry:()=>save(),download,
    discard:()=>{pending.current=null;setFailed(false)},isDirty:()=>phaseRef.current!=='idle'||!!pending.current||savingRef.current,
    active:phase!=='idle',busy:phase!=='idle'||saving||failed};
}
