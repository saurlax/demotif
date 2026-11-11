import {clipSchema,trackSchema,type ClientRender} from '@/shared/schema';
import type {Project} from '@/types/project';

export function renderProjectSnapshot(project:Project,request:Omit<ClientRender,'request_id'>){
  const context=request.context;
  if(project.version!==context.expected_version)throw Error('The selected Clip changed. Select it again before rendering.');
  const track=project.document.tracks.find(t=>t.id===context.track_id),clip=track?.clips.find(c=>c.id===context.clip_id);
  const source=project.document.sources.find(s=>s.id===(clip?.source_id??context.source_id));
  if((context.clip_id&&!clip)||(!clip&&!source))throw Error('The selected Clip is unavailable.');
  if(track?.locked||clip?.locked)throw Error('The selected Clip is locked.');
  if(request.sound&&source?.kind!=='notes')throw Error('Choose an instrumental note Clip for an instrument override.');
  const seconds=clip?clip.length_beats*60/project.document.tempo:source!.duration*(source!.kind==='audio'?1:60/project.document.tempo);
  const capturedClip=clip?{...clip,start_beat:0}:clipSchema.parse({id:'render-clip',name:source!.name,source_id:source!.id,kind:source!.kind==='audio'?'audio':'midi',length_beats:seconds*project.document.tempo/60,source_duration:source!.duration});
  const capturedTrack=track??trackSchema.parse({id:'render-track',name:source!.name,kind:source!.kind==='audio'?'audio':'instrument'});
  return {seconds,project:{...project,document:{...project.document,tracks:[{...capturedTrack,muted:false,solo:false,clips:[capturedClip]}],sources:project.document.sources.map(s=>s.id===source?.id&&request.sound?{...s,sound:request.sound,asset_id:null,sampler:null}:s)}}};
}
