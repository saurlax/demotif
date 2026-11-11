import {useEffect,useRef,useState} from 'react'
import {notifyError} from '@/lib/notifications'
import type {Project} from '@/types/project'
import type {AudioContext as MusicalContext} from '@/shared/schema'
import type {useProducerController} from './use-producer-controller'
import {VoiceActivity} from './voice-activity'

type Phase='idle'|'requesting'|'listening'|'transcribing'|'thinking'|'preparing'|'speaking'
type Capture={project:string;version:number;context?:MusicalContext}
type Resources={epoch:number;open:boolean;recorder?:MediaRecorder;stream?:MediaStream;audio?:AudioContext;frame?:number;request?:AbortController;player?:HTMLAudioElement;url?:string;capture?:Capture;run?:string;waiting:boolean}
export function useProducerTurnVoice(project:Project|undefined,session:ReturnType<typeof useProducerController>,context:MusicalContext|null,callbacks?:{drained:(run:string)=>void;interrupted:()=>void}){
  const [phase,setPhase]=useState<Phase>('idle')
  const [waitingRun,setWaitingRun]=useState<string|null>(null)
  const latest=useRef({project,session,context})
  useEffect(()=>{latest.current={project,session,context}},[project,session,context])
  const resources=useRef<Resources>({epoch:0,open:false,waiting:false})
  const mounted=useRef(true)
  const held=useRef(false)
  function releaseMic(){
    const r=resources.current
    if(r.frame!==undefined)cancelAnimationFrame(r.frame);r.frame=undefined
    if(r.recorder){r.recorder.ondataavailable=null;r.recorder.onstop=null;r.recorder.onerror=null;if(r.recorder.state!=='inactive')r.recorder.stop();r.recorder=undefined}
    r.stream?.getTracks().forEach(track=>track.stop());r.stream=undefined
    if(r.audio){void r.audio.close().catch(()=>{});r.audio=undefined}
  }
  function release(){
    const r=resources.current;r.epoch++;r.request?.abort();r.request=undefined;releaseMic()
    if(r.player){r.player.onended=null;r.player.onerror=null;r.player.onplaying=null;r.player.pause();r.player.removeAttribute('src');r.player.load();r.player=undefined}
    if(r.url)URL.revokeObjectURL(r.url);r.url=undefined
    const pending=r.waiting&&r.run&&r.capture?{run:r.run,project:r.capture.project}:null
    r.waiting=false;r.run=undefined
    return pending
  }
  async function cancelOwned(pending:ReturnType<typeof release>){if(pending)await fetch(`/api/projects/${pending.project}/producer/runs/${pending.run}/cancel`,{method:'POST'}).catch(()=>{})}
  function end(){callbacks?.interrupted();const r=resources.current;r.open=false;const pending=release();void cancelOwned(pending);if(mounted.current){setPhase('idle');setWaitingRun(null)}}
  function fail(error:unknown){end();notifyError(error instanceof Error?error.message:'Voice conversation stopped.')}
  async function listen(){
    const r=resources.current,p=latest.current.project;if(!r.open||!p||held.current)return
    const epoch=++r.epoch;r.capture={project:p.id,version:p.version,context:latest.current.context?structuredClone({...latest.current.context,expected_version:p.version}):undefined};r.waiting=false;r.run=undefined
    setPhase('requesting')
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Microphone recording is unavailable in this browser.')
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      if(!r.open||r.epoch!==epoch){stream.getTracks().forEach(t=>t.stop());return}
      r.stream=stream;r.audio=new AudioContext();await r.audio.resume()
      if(!r.open||r.epoch!==epoch)return
      const analyser=r.audio.createAnalyser();analyser.fftSize=1024;r.audio.createMediaStreamSource(stream).connect(analyser)
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[]
      const vad=new VoiceActivity(performance.now()),samples=new Float32Array(analyser.fftSize),captured=r.capture
      r.recorder=recorder
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      recorder.onerror=()=>{if(r.open&&r.epoch===epoch)fail(new Error('Microphone recording failed.'))}
      recorder.onstop=()=>{
        if(!r.open||r.epoch!==epoch)return
        releaseMic()
        if(!vad.heardSpeech){void listen();return}
        const blob=new Blob(chunks,{type:recorder.mimeType});void transcribe(blob,captured,epoch)
      }
      const sample=()=>{
        if(!r.open||r.epoch!==epoch||recorder.state!=='recording')return
        analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length)
        const state=vad.sample(rms,performance.now())
        if(state!=='continue'){recorder.stop();return}
        r.frame=requestAnimationFrame(sample)
      }
      recorder.start(200);setPhase('listening');r.frame=requestAnimationFrame(sample)
    }catch(error){if(r.open&&r.epoch===epoch)fail(error)}
  }
  async function transcribe(blob:Blob,captured:Capture,epoch:number){
    const r=resources.current;setPhase('transcribing');r.request=new AbortController()
    try{
      const response=await fetch(`/api/projects/${captured.project}/producer/voice/transcriptions`,{method:'POST',body:blob,signal:r.request.signal})
      const body=await response.json();if(!response.ok)throw new Error(body.message??'Speech recognition failed.')
      if(!r.open||r.epoch!==epoch)return
      if(!body.text?.trim()){void listen();return}
      setPhase('thinking')
      const id=await latest.current.session.sendText(body.text,captured.context,true,captured.version)
      if(!r.open||r.epoch!==epoch){if(id)void cancelOwned({project:captured.project,run:id});return}
      if(!id){end();return}
      r.run=id;r.waiting=true;setWaitingRun(id)
      // The completed run may already be present when POST/load returns.
      setPhase('thinking')
    }catch(error){if(r.open&&r.epoch===epoch)fail(error)}
  }
  async function speak(runId:string){
    const r=resources.current,epoch=r.epoch;if(!r.open||!r.capture)return
    r.waiting=false;setPhase('preparing');r.request=new AbortController()
    try{
      const response=await fetch(`/api/projects/${r.capture.project}/producer/runs/${runId}/speech`,{method:'POST',signal:r.request.signal})
      if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.message??'Voice playback is unavailable.')}
      const blob=await response.blob();if(!r.open||r.epoch!==epoch)return
      r.url=URL.createObjectURL(blob);r.player=new Audio(r.url)
      r.player.onplaying=()=>{if(r.open&&r.epoch===epoch)setPhase('speaking')}
      r.player.onended=()=>{if(r.open&&r.epoch===epoch){if(r.url)URL.revokeObjectURL(r.url);r.url=undefined;r.player=undefined;callbacks?.drained(runId);void listen()}}
      r.player.onerror=()=>{if(r.open&&r.epoch===epoch)fail(new Error('Voice playback failed.'))}
      await r.player.play()
    }catch(error){if(r.open&&r.epoch===epoch)fail(error)}
  }
  useEffect(()=>{
    const r=resources.current;if(!r.open||!r.waiting||!r.run)return
    const run=session.runs.find(run=>run.id===r.run);if(!run||run.status==='running')return
    if(run.status==='complete')void speak(run.id)
    else fail(new Error('Producer stopped. The conversation is available in the sidebar.'))
  },[session.runs,phase,waitingRun])
  useEffect(()=>{mounted.current=true;const owned=resources.current;const hidden=()=>{if(document.hidden)end()};document.addEventListener('visibilitychange',hidden);return()=>{mounted.current=false;document.removeEventListener('visibilitychange',hidden);owned.open=false;void cancelOwned(release())}},[project?.id])
  function start(){if(!latest.current.session.ready)return;resources.current.open=true;void listen()}
  async function interrupt(){callbacks?.interrupted();const r=resources.current,pending=release();await cancelOwned(pending);if(r.open)void listen()}
  function finish(){const recorder=resources.current.recorder;if(recorder?.state==='recording')recorder.stop()}
  const labels:Record<Phase,string>={idle:'Voice chat',requesting:'Opening microphone…',listening:'Listening…',transcribing:'Recognizing speech…',thinking:'Producer is thinking…',preparing:'Preparing voice…',speaking:'Speaking…'}
  function hold(active:boolean){
    if(held.current===active)return;held.current=active;
    if(active){const pending=release();void cancelOwned(pending);if(resources.current.open)setPhase('listening')}
    else if(resources.current.open)void listen();
  }
  return {open:phase!=='idle',phase,label:labels[phase],start,end,interrupt,finish,hold}
}
