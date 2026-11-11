import {expect,it} from 'vitest';
import {documentSchema} from '@/shared/schema';
import type {Project} from '@/types/project';
import {renderProjectSnapshot} from './render-project-snapshot';
const project={id:'p',version:3,document:documentSchema.parse({tempo:120,sources:[{id:'s',kind:'notes',name:'Piano',duration:8,sound:'piano',asset_id:'sample',sampler:{rootNote:60},notes:[{id:'n',pitch:60,start:2,duration:1,velocity:0.7}]}],tracks:[{id:'t',name:'Original',muted:true,clips:[{id:'c',source_id:'s',kind:'midi',start_beat:12,length_beats:4,offset:2,gain:0.7}]},{id:'other',name:'Unrelated',clips:[]}]})} as Project;
const context={expected_version:3,track_id:'t',clip_id:'c',start_beat:12,offset_seconds:1,duration_seconds:2};
it('renders an isolated captured Clip with its original range, sampler and effects',()=>{
  const result=renderProjectSnapshot(project,{name:'Sound',context});
  expect(result.seconds).toBe(2);expect(result.project.document.tracks).toHaveLength(1);
  expect(result.project.document.tracks[0]).toMatchObject({muted:false,clips:[{start_beat:0,offset:2,gain:0.7,length_beats:4}]});
  expect(result.project.document.sources[0].sampler?.rootNote).toBe(60);
  expect(project.document.tracks[0].clips[0].start_beat).toBe(12);expect(project.document.tracks[0].muted).toBe(true);
});
it('changes only the isolated instrument when an explicit sound is requested',()=>{
  const result=renderProjectSnapshot(project,{name:'Sound',context,sound:'guitar'});
  expect(result.project.document.sources[0]).toMatchObject({sound:'guitar',asset_id:null,sampler:null});
  expect(project.document.sources[0]).toMatchObject({sound:'piano',asset_id:'sample'});
});
it('rejects stale, removed or locked Clip snapshots before rendering',()=>{
  expect(()=>renderProjectSnapshot(project,{name:'x',context:{...context,expected_version:2}})).toThrow('changed');
  expect(()=>renderProjectSnapshot(project,{name:'x',context:{...context,clip_id:'gone'}})).toThrow('unavailable');
  expect(()=>renderProjectSnapshot({...project,document:{...project.document,tracks:project.document.tracks.map(t=>({...t,locked:true}))}},{name:'x',context})).toThrow('locked');
});
