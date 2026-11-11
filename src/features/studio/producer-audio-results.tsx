import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {fetchMedia} from '@/lib/api'
import {notifyError} from '@/lib/notifications'
import {ClipNotePreview} from './clip-note-preview'
import type {Project} from '@/types/project'
import type {useProducerController} from './use-producer-controller'
import type {useClipAudioActions} from './clip-audio-actions'

export function ProducerAudioResults({project,session,audio}:{project:Project;session:ReturnType<typeof useProducerController>;audio:ReturnType<typeof useClipAudioActions>}) {
  const [preview,setPreview]=useState<string|null>(null)
  const player=useRef<HTMLAudioElement>(null)
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview])
  async function audition(url:string){try{player.current?.pause();const response=await fetchMedia(url);if(!response.ok)throw new Error('Audio unavailable');setPreview(URL.createObjectURL(await response.blob()))}catch(e){notifyError(String(e))}}
  if(!audio.jobs.length)return null
  return <section aria-label="Audio results" className="space-y-3 border-t p-3">
    {preview&&<audio ref={player} autoPlay controls src={preview} className="w-full"/>}
    {audio.jobs.map(job=>{
      const sources=job.results.flatMap(r=>r.source?[r.source]:[])
      const applied=sources.length>0&&sources.every(s=>project.document.tracks.some(t=>t.clips.some(c=>c.source_id===s.id)))
      const pendingProposal=session.runs.some(run=>!run.applied&&run.commands.some(c=>c.type==='source.add'&&sources.some(s=>s.id===c.source.id)))
      const stale=job.request.context?.expected_version!==project.version
      return <div key={job.id} className="space-y-2 border-b pb-3">
        <div className="break-words text-sm font-medium">{job.name}</div>
        <div className="text-xs text-muted-foreground">{job.request.reference_only?'Reference':applied?'Applied':job.status}</div>
        {job.results[0]?.analysis&&<div className="h-16 text-primary" role="img" aria-label={`${job.results[0].analysis.notes.length} detected notes`}><ClipNotePreview notes={job.results[0].analysis.notes.map((n,i)=>({...n,id:String(i)}))} offset={0} duration={job.results[0].analysis.duration}/></div>}
        {job.results.map((result,i)=>result.transcript&&<div key={i} className="whitespace-pre-wrap break-words text-sm">
          {result.transcript.text}
          {job.mode==='align'&&<div className="mt-2 space-y-1">
            {result.transcript.words.map((word,j)=><div key={j} className="text-xs text-muted-foreground">{word.start.toFixed(2)}–{word.end.toFixed(2)} s · {word.text}</div>)}
          </div>}
        </div>)}
        {job.status==='complete'&&!job.results.some(r=>r.transcript)&&<div className="flex flex-wrap gap-2">
          {audio.previewUrl(job)&&<Button size="sm" variant="outline" onClick={()=>void audition(audio.previewUrl(job)!)}>Audition</Button>}
          {!job.request.reference_only&&!applied&&!pendingProposal&&<>
            <Button size="sm" disabled={audio.busy||!!session.active||stale} onClick={()=>void audio.accept(job)}>Apply</Button>
            {stale&&<Button size="sm" variant="outline" disabled={audio.busy||!!session.active} onClick={()=>void audio.accept(job,true)}>Use current destination</Button>}
          </>}
        </div>}
      </div>
    })}
  </section>
}
