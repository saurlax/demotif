import {emptySource} from '@/audio/adapter';
import type {VocalTake} from '@/audio/vocal-recorder';
import type {ProducerCommand} from '@/types/project';
import {recordingIds,type RecordingPlan,type RecordingControl} from '@/shared/studio-control';
export type PerformanceSnapshot={projectId:string;version:number;origin:number;tempo:number;meter:string;name:string;plan?:RecordingPlan;control?:RecordingControl};
export function performanceCommands(take:VocalTake,snapshot:PerformanceSnapshot,assetId:string):ProducerCommand[]{
  if(!take.pcm.length||take.duration<=0)throw new Error('The recording contains no captured audio.');
  const ids=recordingIds(snapshot.control?.requestId??take.id),target=snapshot.plan?.target;
  const trackId=target?.kind==='existing_track'?target.track_id:ids.track_id;
  const source={...emptySource('audio'),id:ids.source_id,name:snapshot.name,asset_id:assetId,duration:take.duration};
  const length=Math.min(take.duration*snapshot.tempo/60,snapshot.plan?snapshot.plan.end_beat-snapshot.plan.start_beat:Infinity);
  return [
    {type:'source.add',source},
    {type:'part.add',part:{id:ids.part_id,name:source.name,source_id:source.id,offset:0,duration:take.duration}},
    ...(target?.kind==='existing_track'?[]:[{type:'track.add' as const,id:trackId,name:target?.name??source.name,kind:'audio' as const}]),
    {type:'clip.add',id:ids.clip_id,track_id:trackId,name:source.name,kind:'audio',source_id:source.id,start_beat:snapshot.origin,length_beats:length,offset:0,source_duration:take.duration},
  ];
}
