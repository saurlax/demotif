import {afterEach,beforeEach,expect,it} from 'vitest';
import {Store} from '@/server/db';
import {createProject,getProject,applyCommands,undo,readProject} from '@/server/projects';
import {storeAsset} from '@/server/media';
import {pcmWave} from '@/server/audio-providers/pcm';
import {performanceCommands,type PerformanceSnapshot} from './performance-placement';
import type {VocalTake} from '@/audio/vocal-recorder';
import type {RecordingPlan} from '@/shared/studio-control';
let db:Store;
beforeEach(()=>{db=new Store(':memory:')});afterEach(()=>db.db.close());
function take(id:string):VocalTake{return {id,pcm:new Float32Array(48000),sampleRate:24000,startFrame:20000,duration:2,interrupted:false,blob:new Blob()}}
it('places recordings at their captured origin, preserves older tracks and reuses receipts after a lost acknowledgement',async()=>{
  const p=createProject(db,'Recording',{},true);
  const asset=await storeAsset(db,p.id,'capture.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  const snapshot:PerformanceSnapshot={projectId:p.id,version:p.version,origin:7.5,tempo:90,meter:'6/8',name:'Recording 1'};
  const commands=performanceCommands(take('first'),snapshot,asset.id),request={request_id:'capture-first',expected_version:p.version,commands};
  applyCommands(db,p.id,request,true);
  // Same receipt is safe even though its expected_version is now old.
  applyCommands(db,p.id,request,true);
  expect(getProject(db,p.id).version).toBe(2);
  const first=JSON.parse(getProject(db,p.id).document).tracks[0];
  expect(first).toMatchObject({muted:false,solo:false,kind:'audio',clips:[{start_beat:7.5,length_beats:3,source_duration:2}]});
  applyCommands(db,p.id,{expected_version:2,commands:[{type:'track.update',track_id:first.id,muted:true}]});
  const prior=JSON.parse(getProject(db,p.id).document).tracks[0];
  const second=performanceCommands(take('second'),{...snapshot,version:3,name:'Recording 2'},asset.id);
  applyCommands(db,p.id,{expected_version:3,commands:second});
  const d=JSON.parse(getProject(db,p.id).document);
  expect(d.tracks).toHaveLength(2);expect(d.tracks[0]).toEqual(prior);expect(d.tracks[1].muted).toBe(false);
  expect(d.parts).toHaveLength(2);expect(readProject(db,getProject(db,p.id)).has_unsaved_changes).toBe(true);
  undo(db,p.id,4);expect(JSON.parse(getProject(db,p.id).document).tracks).toEqual([prior]);
});
it('rejects stale placement without losing or altering recorded PCM',async()=>{
  const p=createProject(db,'Recording',{},true),t=take('recovery');t.pcm[0]=.25;
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'project.set_tempo',tempo:85}]});
  const snapshot={projectId:p.id,version:1,origin:4,tempo:120,meter:'4/4',name:'Captured'};
  expect(()=>applyCommands(db,p.id,{expected_version:1,commands:performanceCommands(t,snapshot,'unuploaded')})).toThrow();
  expect(t.pcm[0]).toBe(.25);expect(JSON.parse(getProject(db,p.id).document).tracks).toHaveLength(0);
  expect(()=>performanceCommands({...t,pcm:new Float32Array(0)},snapshot,'asset')).toThrow('no captured audio');
});
it('uses the explicitly selected audio track and finite origin while preserving prior clips and lock checks',async()=>{
  const p=createProject(db,'Existing target',{tracks:[{id:'target',kind:'audio',name:'Voice',muted:true}]},true);
  const asset=await storeAsset(db,p.id,'capture.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  const plan:RecordingPlan={segment:'Ending line',name:'New line',target:{kind:'existing_track',track_id:'target'},start_beat:12,end_beat:15,count_in:'four',accompaniment:false,after_recording:'keep_audio'};
  const commands=performanceCommands(take('line'),{projectId:p.id,version:1,origin:12,tempo:120,meter:'4/4',name:'New line',plan},asset.id);
  expect(commands.some(c=>c.type==='track.add')).toBe(false);
  applyCommands(db,p.id,{expected_version:1,commands});const d=JSON.parse(getProject(db,p.id).document);
  expect(d.tracks).toHaveLength(1);expect(d.tracks[0]).toMatchObject({muted:true,clips:[{start_beat:12,length_beats:3}]});
  applyCommands(db,p.id,{expected_version:2,commands:[{type:'track.set_lock',track_id:'target',locked:true}]});
  expect(()=>applyCommands(db,p.id,{expected_version:3,commands:performanceCommands(take('locked'),{projectId:p.id,version:3,origin:12,tempo:120,meter:'4/4',name:'New line',plan},asset.id)})).toThrow();
});
