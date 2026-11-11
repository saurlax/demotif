import {useEffect,useRef,useState} from 'react'
import {ArrowUp,MousePointer2,Square,AudioLines,PhoneOff} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {ProducerMarkdown} from './producer-markdown'
import {notifyError} from '@/lib/notifications'
import type {useProducerController} from './use-producer-controller'
import type {useClipAudioActions,ProducerActivity} from './clip-audio-actions'
import type {Project} from '@/types/project'
import type {useProducerVoice} from './use-producer-voice'

export function ProducerComposer({project,session,audio,voice}:{project:Project;session:ReturnType<typeof useProducerController>;audio:ReturnType<typeof useClipAudioActions>;voice:ReturnType<typeof useProducerVoice>}) {
  const input=useRef<HTMLTextAreaElement>(null),root=useRef<HTMLDivElement>(null),output=useRef<HTMLDivElement>(null)
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight,left:0,right:window.innerWidth,bottom:window.innerHeight,composerHeight:58,targetBottom:0,targetTop:0,targetLeft:0})
  useEffect(()=>{let frame=0;const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const target=audio.context?.clip_id?document.querySelector(`[data-producer-clip="${CSS.escape(audio.context.clip_id)}"]`):audio.context?.track_id?document.querySelector(`[data-library-track="${CSS.escape(audio.context.track_id)}"]`):null;const rect=target?.getBoundingClientRect(),area=document.querySelector('.studio-arrangement')?.getBoundingClientRect();setViewport({width:window.innerWidth,height:window.innerHeight,left:Math.max(0,area?.left??0),right:Math.min(window.innerWidth,area?.right??window.innerWidth),bottom:area?.bottom??window.innerHeight,composerHeight:root.current?.offsetHeight??58,targetBottom:rect?.bottom??0,targetTop:rect?.top??0,targetLeft:rect?.left??0})})};const observer=new ResizeObserver(resize);const arrangement=document.querySelector('.studio-arrangement');if(arrangement)observer.observe(arrangement);if(root.current)observer.observe(root.current);window.addEventListener('resize',resize);document.addEventListener('scroll',resize,true);resize();return()=>{cancelAnimationFrame(frame);frame=0;observer.disconnect();document.removeEventListener('scroll',resize,true);window.removeEventListener('resize',resize)}},[audio.context?.clip_id,audio.context?.track_id])
  useEffect(()=>{const field=input.current;if(field){field.style.height='auto';field.style.height=`${Math.min(128,field.scrollHeight)}px`}},[session.draft])
  useEffect(()=>{if(audio.action)input.current?.focus()},[audio.action,audio.context?.clip_id,audio.anchor?.x,audio.anchor?.y])
  const processing=audio.busy||audio.pending.length>0||session.sending||!!session.active
  const clip=project.document.tracks.flatMap(t=>t.clips).find(c=>c.id===audio.context?.clip_id)
  const source=project.document.sources.find(s=>s.id===(audio.context?.source_id??clip?.source_id))
  const reference=audio.context?`${clip?.name??source?.name??'Selected location'}${audio.context.note_ids?.length?` · ${audio.context.note_ids.length} selected notes`:''}`:'Whole project'
  const run=session.active??session.runs.at(-1)
  const events=run?.events??[]
  let recentOutput='',streamingText=false
  for(const e of events){
    if(e.type==='text'){recentOutput=(streamingText?recentOutput:'')+(e.delta??'');streamingText=true}
    else if(e.type==='reply')recentOutput=e.text??recentOutput
    else if(e.type==='activity'&&e.text){recentOutput=e.text;streamingText=false}
    else if(e.type==='tool'&&e.name==='process_audio'){recentOutput='Processing audio…';streamingText=false}
  }
  if(!processing)recentOutput=events.findLast(e=>e.type==='reply')?.text??recentOutput
  const preview=session.sending&&!session.active?'Working…':recentOutput||(processing?(audio.activity?.text??'Working…'):'')
  useEffect(()=>{const element=output.current;if(element)element.scrollTop=element.scrollHeight},[preview])
  const event=events.filter(e=>e.type==='activity').at(-1)
  const marker:ProducerActivity|null=audio.activity??(event?.target?{target:event.target,status:event.status??'working',text:event.text??'Working'}:null)
  const width=Math.max(0,Math.min(480,viewport.width-24,viewport.right-viewport.left-24)),height=viewport.composerHeight
  const minLeft=viewport.left+12,maxLeft=Math.max(minLeft,viewport.right-width-12)
  const contextTop=viewport.targetBottom>0?(viewport.targetBottom+height+24<viewport.height?viewport.targetBottom+12:viewport.targetTop-height-12):audio.anchor?audio.anchor.y+16:0
  const style=audio.anchor?{left:Math.max(minLeft,Math.min(maxLeft,viewport.targetLeft||audio.anchor.x+16)),top:Math.max(72,Math.min(viewport.height-height-12,contextTop)),width}:{left:Math.max(minLeft,(viewport.left+viewport.right-width)/2),top:Math.max(110,viewport.bottom-height-12),width}
  async function submit(){if(processing||!session.ready||!session.draft.trim())return;audio.setActivity(null);await session.send(audio.context??undefined)}
  return <>
    <ProducerCursor activity={marker}/>
    <div ref={root} className="producer-composer fixed z-40 flex flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground" style={style} data-producer-composer>
      {preview&&<div ref={output} role="status" aria-label="Latest Producer output" aria-live="polite" aria-atomic="true" className="max-h-24 w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm leading-5"><ProducerMarkdown>{preview}</ProducerMarkdown></div>}
      <div className="flex w-full min-w-0 items-center gap-2">
      {voice.open?<>
        <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 text-sm" role="status"><AudioLines className={`size-4 shrink-0 text-primary ${voice.phase==='listening'?'animate-pulse motion-reduce:animate-none':''}`}/><span>{voice.label}</span></div>
        <Button size="icon" className="size-10" variant="ghost" aria-label="End voice chat" onClick={voice.end}><PhoneOff/></Button>
      </>:<>
        <textarea ref={input} rows={1} aria-label="Message Producer" aria-describedby="producer-input-context" data-saved-value="" value={session.draft} onChange={e=>session.setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit()}}} placeholder="Ask Producer…" className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-md bg-transparent px-3 py-2.5 text-sm leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"/>
        {processing?<Button size="icon" className="size-10" aria-label="Stop Producer" onClick={()=>void Promise.all([audio.cancel(),session.cancel()]).catch(e=>notifyError(String(e)))}><Square/></Button>:session.draft.trim()?<Button size="icon" className="size-10" aria-label="Send message" disabled={!session.ready} onClick={()=>void submit()}><ArrowUp/></Button>:<Button size="icon" className="size-10" aria-label="Start voice chat" title={voice.ready?'Voice chat':'Voice is not configured'} disabled={!voice.ready} onClick={voice.start}><AudioLines/></Button>}
      </>}
      </div>
      <span id="producer-input-context" className="sr-only">Reference: {reference}</span>
    </div>
  </>
}

function ProducerCursor({activity}:{activity:ProducerActivity|null}) {
  const [point,setPoint]=useState<{x:number;y:number}|null>(null)
  useEffect(()=>{if(!activity){setPoint(null);return}let frame=0
    const update=()=>{const t=activity.target;const q=t.note_ids?.length?`[data-producer-note="${CSS.escape(t.note_ids[0])}"]`:t.clip_id?`[data-producer-clip="${CSS.escape(t.clip_id)}"]`:t.source_id?`[data-producer-source="${CSS.escape(t.source_id)}"]`:t.track_id?`[data-library-track="${CSS.escape(t.track_id)}"]`:'';const element=(q?document.querySelector<HTMLElement>(q):null)??(t.source_id?document.querySelector<HTMLElement>(`[data-producer-source="${CSS.escape(t.source_id)}"]`):null);const r=element?.getBoundingClientRect();if(r){let x=r.left+Math.min(24,r.width/2);if(!t.clip_id&&t.start_beat!=null)x=r.left+t.start_beat*Number(element?.dataset.timelineScale??0);const visible=r.bottom>80&&r.top<window.innerHeight-20&&x>=0&&x<window.innerWidth;setPoint(visible?{x:Math.min(window.innerWidth-160,x),y:Math.max(78,r.top+8)}:null)}else setPoint(null)}
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)};update();document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);const observer=new ResizeObserver(schedule);const root=document.querySelector('.studio-daw');if(root)observer.observe(root);const timer=setInterval(schedule,300);return()=>{clearInterval(timer);cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule)}
  },[activity])
  if(!activity||!point)return null
  return <div className="producer-cursor pointer-events-none fixed z-30 flex max-w-60 items-start gap-1 text-primary" style={{left:point.x,top:point.y}} aria-hidden="true"><MousePointer2 className="size-5 shrink-0 fill-primary/20"/><span className="rounded border border-primary/40 bg-popover px-2 py-1 text-xs text-foreground">Producer · {activity.status}<span className="block">{activity.text}</span></span></div>
}
