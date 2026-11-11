import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Store} from './db';
import {createProject,applyCommands,getProject} from './projects';
import {append,startProducer,requireRun,continueRecordedProducer,producerHistory} from './producer';
import {completeStudioControl,requestStudioControl} from './producer-control';
import {MockLanguageModelV4} from 'ai/test';
import {recordingPlanSchema,studioActionSchema,recordingIds,type RecordingPlan} from '@/shared/studio-control';
import {validateStudioControl,recordingContinuation} from './producer-control';
import {storeAsset} from './media';
import {pcmWave} from './audio-providers/pcm';
import {performanceCommands} from '@/features/studio/performance-placement';
import type {VocalTake} from '@/audio/vocal-recorder';
import {saveDraft} from './projects';
const plan:RecordingPlan={segment:'The opening four-note phrase',name:'Hummed phrase',target:{kind:'new_track',name:'Melody ideas'},start_beat:4,end_beat:8,count_in:'four',accompaniment:false,after_recording:'transcribe_notes'};
const state=vi.hoisted(()=>({runtime:undefined as unknown}));
vi.mock('./db',async original=>({...await original<typeof import('./db')>(),runtime:async()=>state.runtime}));
let db:Store;
beforeEach(()=>{db=new Store(':memory:');state.runtime={store:db,producerTasks:new Map()}});afterEach(()=>db.db.close());
function fixture(){const p=createProject(db,'Control',{},true);db.run("INSERT INTO producer_runs VALUES ('run',?,1,'Record','running','[]',NULL,0,'now')",p.id);append(db,'run',{type:'studio_control',request_id:'request',client_id:'owner',expected_version:1,control:{action:'prepare_recording',plan}});return p;}
const body={request_id:'request',client_id:'owner'};
it('requires the initiating browser, one claim and a real acknowledgement; duplicates cannot execute again',()=>{
  const p=fixture();
  expect(()=>completeStudioControl(db,p.id,'run',{...body,action:'complete'})).toThrow('Claim');
  expect(()=>completeStudioControl(db,p.id,'run',{...body,client_id:'other',action:'claim'})).toThrow('does not own');
  expect(completeStudioControl(db,p.id,'run',{...body,action:'claim'})).toEqual({status:'claimed'});
  expect(completeStudioControl(db,p.id,'run',{...body,action:'claim'})).toEqual({status:'already_claimed'});
  expect(completeStudioControl(db,p.id,'run',{...body,action:'complete'})).toEqual({status:'complete'});
  db.run("UPDATE producer_runs SET status='complete' WHERE id='run'");
  expect(completeStudioControl(db,p.id,'run',{...body,action:'claim'})).toEqual({status:'complete'});
  expect(()=>completeStudioControl(db,p.id,'run',{...body,client_id:'other',action:'complete'})).toThrow('does not own');
  expect(getProject(db,p.id).version).toBe(1);
});
it('rejects another project, stale versions and cancelled runs',()=>{
  const p=fixture(),other=createProject(db,'Other',{},true);
  expect(()=>completeStudioControl(db,other.id,'run',{...body,action:'claim'})).toThrow('not found');
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'project.set_tempo',tempo:90}]});
  expect(()=>completeStudioControl(db,p.id,'run',{...body,action:'claim'})).toThrow('changed');
  db.run("UPDATE producer_runs SET status='cancelled' WHERE id='run'");
  expect(()=>completeStudioControl(db,p.id,'run',{...body,action:'claim'})).toThrow('no longer');
});
it('cancels disconnected-browser waiting without publishing success',async()=>{
  const p=fixture(),abort=new AbortController(),emit=vi.fn();
  const pending=requestStudioControl(db,p.id,'run','owner',1,{action:'stop'},emit,abort.signal);
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({type:'studio_control'}));abort.abort();
  await expect(pending).rejects.toThrow();
});
it('reports browser failure to the actual Producer tool and retains browser ownership on retry',async()=>{
  const p=createProject(db,'Agent control',{},true);let step=0;
  const model=new MockLanguageModelV4({doStream:async()=>({stream:new ReadableStream({start(c){
    if(step++===0)c.enqueue({type:'tool-call',toolCallId:'control',toolName:'record_audio',input:JSON.stringify(plan)});
    else {c.enqueue({type:'text-start',id:'reply'});c.enqueue({type:'text-delta',id:'reply',delta:'Microphone permission is needed.'});c.enqueue({type:'text-end',id:'reply'});}
    c.enqueue({type:'finish',finishReason:{unified:step===1?'tool-calls':'stop',raw:step===1?'tool_calls':'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}});c.close();
  }})})});
  const input={id:'agent',text:'Four clicks then record',expected_version:1,client_id:'owner'};
  await startProducer(db,p.id,input,model);
  await expect(startProducer(db,p.id,{...input,client_id:'second'},model)).rejects.toThrow('already used');
  let request:{request_id:string}|undefined;
  await vi.waitFor(()=>{const row=db.get<{payload:string}>("SELECT payload FROM producer_events WHERE run_id='agent' AND json_extract(payload,'$.type')='studio_control'");expect(row).toBeDefined();request=JSON.parse(row!.payload)});
  const response={request_id:request!.request_id,client_id:'owner'};
  completeStudioControl(db,p.id,'agent',{...response,action:'claim'});
  completeStudioControl(db,p.id,'agent',{...response,action:'fail',error:'Microphone permission denied.'});
  await vi.waitFor(()=>expect(requireRun(db,p.id,'agent').status).toBe('complete'));
  expect(getProject(db,p.id).version).toBe(1);
});
it('requires every recording choice and rejects ambiguous ranges or the old underspecified path',()=>{
  for(const key of ['segment','name','target','start_beat','end_beat','count_in','accompaniment','after_recording']){
    const input={...plan} as Record<string,unknown>;delete input[key];expect(recordingPlanSchema.safeParse(input).success).toBe(false);
  }
  expect(recordingPlanSchema.safeParse({...plan,end_beat:plan.start_beat}).success).toBe(false);
  expect(recordingPlanSchema.safeParse({...plan,start_beat:-1}).success).toBe(false);
  expect(studioActionSchema.safeParse({action:'prepare_recording',count_in:'four'}).success).toBe(false);
});
it('validates target track kind, ownership and locks before preparing',()=>{
  const p=createProject(db,'Targets',{tracks:[{id:'audio',name:'Vocal',kind:'audio',locked:true},{id:'notes',name:'Piano',kind:'instrument'}]},true);
  const control=(id:string)=>({action:'prepare_recording' as const,plan:{...plan,target:{kind:'existing_track' as const,track_id:id}}});
  expect(()=>validateStudioControl(db,p.id,control('missing'))).toThrow('audio track');
  expect(()=>validateStudioControl(db,p.id,control('notes'))).toThrow('audio track');
  expect(()=>validateStudioControl(db,p.id,control('audio'))).toThrow('locked');
});
it('only returns a fresh recording context after a real owned placement receipt, and deduplicates lifecycle acknowledgement',async()=>{
  const p=fixture();completeStudioControl(db,p.id,'run',{...body,action:'claim'});completeStudioControl(db,p.id,'run',{...body,action:'complete'});db.run("UPDATE producer_runs SET status='complete' WHERE id='run'");
  const notification={...body,action:'recording',recording_status:'placed'};
  expect(()=>completeStudioControl(db,p.id,'run',notification)).toThrow('not been accepted');
  const asset=await storeAsset(db,p.id,'humming.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  const take:VocalTake={id:'captured',pcm:new Float32Array(48000),sampleRate:24000,startFrame:30000,duration:2,interrupted:false,blob:new Blob()};
  const snapshot={projectId:p.id,version:1,origin:4,tempo:120,meter:'4/4',name:plan.name,plan,control:{requestId:'request',runId:'run',clientId:'owner'}};
  applyCommands(db,p.id,{expected_version:1,request_id:recordingIds('request').receipt_id,commands:performanceCommands(take,snapshot,asset.id)},true);
  const first=completeStudioControl(db,p.id,'run',notification);expect(first).toMatchObject({status:'accepted',recording:{source_id:'recording-request',version:2,context:{expected_version:2,start_beat:4,duration_seconds:2}}});
  expect(completeStudioControl(db,p.id,'run',notification)).toEqual(first);
  expect(db.all("SELECT * FROM producer_events WHERE json_extract(payload,'$.type')='studio_recording_placed'")).toHaveLength(1);
  expect(()=>recordingContinuation(db,p.id,'run','request','foreign')).toThrow('does not own');
  expect(recordingContinuation(db,p.id,'run','request','owner').context.clip_id).toBe('recording-clip-request');
  const calls=vi.fn();
  const model=new MockLanguageModelV4({doStream:async options=>{calls(options);return {stream:new ReadableStream({start(c){c.enqueue({type:'text-start',id:'reply'});c.enqueue({type:'text-delta',id:'reply',delta:'The recorded phrase is ready.'});c.enqueue({type:'text-end',id:'reply'});c.enqueue({type:'finish',finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}});c.close()}})}}});
  const follow=await continueRecordedProducer(db,p.id,'run',body,model);
  await vi.waitFor(()=>expect(requireRun(db,p.id,follow.id).status).toBe('complete'));
  expect(JSON.stringify(calls.mock.calls[0])).toContain('recording-clip-request');expect(JSON.stringify(calls.mock.calls[0])).toContain('Accepted project version: 2');
  expect((await continueRecordedProducer(db,p.id,'run',body,model)).id).toBe(follow.id);expect(calls).toHaveBeenCalledOnce();
  expect(producerHistory(db,p.id).runs.find(r=>r.id===follow.id)?.prompt).toBe('');
});
it('waits for a real Save as and acknowledges its new version',()=>{
  const p=createProject(db,'Draft',{},true);
  db.run("INSERT INTO producer_runs VALUES ('save-run',?,1,'Save','running','[]',NULL,0,'now')",p.id);
  append(db,'save-run',{type:'studio_control',request_id:'save-request',client_id:'owner',expected_version:1,control:{action:'save',plan:{save_as:true,name:'Saved song'}}});
  const b={request_id:'save-request',client_id:'owner'};completeStudioControl(db,p.id,'save-run',{...b,action:'claim'});
  expect(()=>completeStudioControl(db,p.id,'save-run',{...b,action:'complete',version:1})).toThrow('saved draft');
  const saved=saveDraft(db,p.id,{expected_version:1,save_as:true,name:'Saved song'});
  expect(completeStudioControl(db,p.id,'save-run',{...b,action:'complete',version:saved.project.version})).toEqual({status:'complete'});
});
it('serializes actual Save and export tool calls using the newly saved version',async()=>{
  const p=createProject(db,'File tools',{},true);let step=0;
  const model=new MockLanguageModelV4({doStream:async()=>({stream:new ReadableStream({start(c){
    if(step++===0){
      c.enqueue({type:'tool-call',toolCallId:'save',toolName:'save_project',input:JSON.stringify({save_as:true,name:'Saved through tool'})});
      c.enqueue({type:'tool-call',toolCallId:'export',toolName:'export_audio',input:'{}'});
    }else{c.enqueue({type:'text-start',id:'reply'});c.enqueue({type:'text-delta',id:'reply',delta:'Saved and exported.'});c.enqueue({type:'text-end',id:'reply'});}
    c.enqueue({type:'finish',finishReason:{unified:step===1?'tool-calls':'stop',raw:step===1?'tool_calls':'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}});c.close();
  }})})});
  await startProducer(db,p.id,{id:'file-tools',text:'Save as and export',expected_version:1,client_id:'owner'},model);
  const controls=()=>db.all<{payload:string}>("SELECT payload FROM producer_events WHERE run_id='file-tools' AND json_extract(payload,'$.type')='studio_control' ORDER BY seq").map(e=>JSON.parse(e.payload));
  await vi.waitFor(()=>expect(controls()).toHaveLength(1));const first=controls()[0];expect(first.control.action).toBe('save');
  const b={request_id:first.request_id,client_id:'owner'};completeStudioControl(db,p.id,'file-tools',{...b,action:'claim'});
  const saved=saveDraft(db,p.id,{expected_version:1,save_as:true,name:'Saved through tool'});completeStudioControl(db,p.id,'file-tools',{...b,action:'complete',version:saved.project.version});
  await vi.waitFor(()=>expect(controls()).toHaveLength(2));const second=controls()[1];expect(second).toMatchObject({expected_version:2,control:{action:'export'}});
  const exportReply={request_id:second.request_id,client_id:'owner'};completeStudioControl(db,p.id,'file-tools',{...exportReply,action:'claim'});completeStudioControl(db,p.id,'file-tools',{...exportReply,action:'complete'});
  await vi.waitFor(()=>expect(requireRun(db,p.id,'file-tools').status).toBe('complete'));
  expect(getProject(db,p.id).version).toBe(2);
});
