import type {AudioContext} from '@/shared/schema'
import type {Project} from '@/types/project'

export function selectionContext(project:Project,selection:{trackId?:string;clipId?:string;sourceId?:string;noteIds?:string[]}):AudioContext|null {
  const track=selection.trackId?project.document.tracks.find(t=>t.id===selection.trackId):project.document.tracks.find(t=>t.clips.some(c=>c.id===selection.clipId))
  const matchedClip=track?.clips.find(c=>c.id===selection.clipId)
  const clip=matchedClip&&(!selection.sourceId||matchedClip.source_id===selection.sourceId)?matchedClip:undefined
  const source=project.document.sources.find(s=>s.id===(clip?.source_id??selection.sourceId))
  if(!clip&&!source)return null
  const unit=source?.kind==='audio'||clip?.kind==='audio'?1:60/project.document.tempo
  const duration=clip?(clip.source_duration??clip.length_beats*(unit===1?60/project.document.tempo:1))*unit:source!.duration*unit
  return {expected_version:project.version,track_id:clip?track?.id??null:null,clip_id:clip?.id??null,start_beat:clip?.start_beat??0,offset_seconds:(clip?.offset??0)*unit,...(duration>0?{duration_seconds:duration}:{}),...(source?{source_id:source.id}:{}),...(selection.noteIds?{note_ids:selection.noteIds.filter(id=>source?.notes.some(n=>n.id===id))}:{})}
}
