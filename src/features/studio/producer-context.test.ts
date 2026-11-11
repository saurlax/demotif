import {expect,it} from 'vitest'
import {documentSchema,audioContextSchema} from '@/shared/schema'
import type {Project} from '@/types/project'
import {selectionContext} from './producer-context'

const project={id:'p',version:7,document:documentSchema.parse({tempo:120,sources:[{id:'s',name:'Notes',kind:'notes',duration:8,notes:[{id:'n',pitch:60,start:2,duration:1,velocity:0.8}]},{id:'other',name:'Other',kind:'notes',duration:4,notes:[]}],tracks:[{id:'t',name:'Track',clips:[{id:'c',name:'Clip',kind:'midi',source_id:'s',start_beat:12,length_beats:4,offset:2}]}]})} as Project
it('captures selected Clip, notes, source range and accepted version without changing the project',()=>{
  const context=selectionContext(project,{trackId:'t',clipId:'c',noteIds:['n','missing']})!
  expect(audioContextSchema.parse(context)).toMatchObject({expected_version:7,track_id:'t',clip_id:'c',source_id:'s',note_ids:['n'],start_beat:12,offset_seconds:1,duration_seconds:2})
  expect(project.document.sources[0].notes[0].pitch).toBe(60)
})
it('references a library/editor source without retaining an unrelated Clip',()=>{
  const context=selectionContext(project,{clipId:'c',sourceId:'other',noteIds:[]})!
  expect(context).toMatchObject({clip_id:null,track_id:null,source_id:'other',note_ids:[],duration_seconds:2})
  expect(selectionContext(project,{clipId:'deleted'})).toBeNull()
})
