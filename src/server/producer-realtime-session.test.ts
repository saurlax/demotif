import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Store} from './db';
import {createProject,getProject,applyCommands,undo} from './projects';
import {RealtimeProducerSession} from './producer-realtime-session';
import {producerHistory,startProducer,append} from './producer';
import {config} from './config';
import {completeStudioControl} from './producer-control';
import {performanceCommands} from '@/features/studio/performance-placement';
import {recordingIds,type RecordingPlan} from '@/shared/studio-control';
import {storeAsset} from './media';
import {pcmWave} from './audio-providers/pcm';
import type {VocalTake} from '@/audio/vocal-recorder';
const sandbox=vi.hoisted(()=>({value:undefined as unknown}));
vi.mock('./db',async original=>({...await original<typeof import('./db')>(),runtime:async()=>sandbox.value}));
let db:Store,p:ReturnType<typeof createProject>,up:Record<string,unknown>[],down:Record<string,unknown>[],session:RealtimeProducerSession;
beforeEach(()=>{db=new Store(':memory:');p=createProject(db,'Realtime',{},true);sandbox.value={store:db,producerTasks:new Map()};up=[];down=[];session=new RealtimeProducerSession(db,p.id,e=>up.push(e),e=>down.push(e));});
afterEach(()=>{session.close();db.db.close();});
function ready(){session.client({type:'demotif.context',version:p.version,context:null});session.provider({type:'session.created'});session.provider({type:'session.updated',session:{input_audio_format:'pcm16',output_audio_format:'pcm16'}});}
function turn(id='input'){session.provider({type:'input_audio_buffer.speech_started',item_id:id});session.provider({type:'input_audio_buffer.committed',item_id:id});session.provider({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:'Make it 95 BPM'});session.provider({type:'response.created',response:{id:'response'}});}
it('gates audio on acknowledgement, configures a nested tool and never forwards provider secrets',()=>{
  expect(()=>session.client({type:'input_audio_buffer.append',audio:'AAA='})).toThrow('Wait');ready();
  expect(up[0]).toMatchObject({type:'session.update',session:{voice:'wenrounansheng',tools:[{type:'function',function:{name:'edit_project'}}]}});
  expect((up[0].session as Record<string,unknown>).turn_detection).toEqual({type:'server_vad'});
  expect(down).toContainEqual({type:'demotif.ready',sample_rate:24000});
  session.provider({type:'error',error:{message:'Bearer private-secret'}});
  expect(JSON.stringify(down)).not.toContain('private-secret');
  expect(()=>session.client({type:'session.update',session:{}})).toThrow();
});
it('persists transcripts once, preserves project ownership and seeds subsequent voice history',()=>{
  ready();turn();session.provider({type:'response.audio_transcript.done',response_id:'response',transcript:'Working on it.'});session.provider({type:'response.audio_transcript.done',response_id:'response',transcript:'Working on it.'});
  const history=producerHistory(db,p.id);expect(history.runs).toHaveLength(1);expect(history.runs[0].prompt).toBe('Make it 95 BPM');expect(history.runs[0].events.filter(e=>e.type==='reply')).toHaveLength(1);
  const other=createProject(db,'Other',{},true);expect(producerHistory(db,other.id).runs).toHaveLength(0);
  const next:Record<string,unknown>[]=[];const second=new RealtimeProducerSession(db,p.id,e=>next.push(e),()=>{});second.provider({type:'session.created'});expect(JSON.stringify(next)).toContain('Working on it.');second.close();
});
it('delegates once, returns actual results, merges voice history and leaves edits undoable',async()=>{
  const delegate=vi.fn(async(db:Store,id:string,input:unknown)=>{
    const request=input as {id:string;expected_version:number;text:string};
    applyCommands(db,id,{request_id:request.id,expected_version:request.expected_version,commands:[{type:'project.set_tempo',tempo:95}]},true);
    db.run("INSERT INTO producer_runs VALUES (?,?,?,?,'complete',?,NULL,1,?)",request.id,id,request.expected_version,request.text,JSON.stringify([{type:'project.set_tempo',tempo:95}]),new Date().toISOString());append(db,request.id,{type:'reply',text:'Tempo changed.'});return{id:request.id,status:'complete'};
  }) as typeof startProducer;
  session=new RealtimeProducerSession(db,p.id,e=>up.push(e),e=>down.push(e),delegate);ready();turn();
  const call={type:'response.function_call_arguments.done',response_id:'response',call_id:'call',name:'edit_project',arguments:JSON.stringify({instruction:'Set tempo to 95'})};session.provider(call);session.provider(call);
  await vi.waitFor(()=>expect(up.some(e=>e.type==='conversation.item.create')).toBe(true));
  expect(delegate).toHaveBeenCalledTimes(1);expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(95);
  session.provider({type:'response.audio_transcript.done',response_id:'response',transcript:'Tempo is now 95.'});
  const history=producerHistory(db,p.id).runs;expect(history).toHaveLength(1);expect(history[0].applied).toBe(true);expect(history[0].prompt).toBe('Make it 95 BPM');
  undo(db,p.id,getProject(db,p.id).version);expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(120);
});
it('keeps stale versions and reports text Producer unavailability without an edit',async()=>{
  ready();turn();applyCommands(db,p.id,{request_id:'manual',expected_version:p.version,commands:[{type:'project.set_tempo',tempo:85}]},true);
  const old=config.llmKey;config.llmKey='';
  try{session.provider({type:'response.function_call_arguments.done',response_id:'response',call_id:'call',name:'edit_project',arguments:'{"instruction":"Set tempo to 95"}'});await vi.waitFor(()=>expect(up.some(e=>e.type==='conversation.item.create')).toBe(true));expect(JSON.stringify(up)).toContain('Configure the producer');expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(85);}finally{config.llmKey=old;}
});
it('interrupts delegated work and ignores repeated old tool events',async()=>{
  let complete!:(value:{id:string;status:string})=>void;
  const delegate=vi.fn(()=>new Promise(resolve=>{complete=resolve})) as unknown as typeof startProducer;
  session=new RealtimeProducerSession(db,p.id,e=>up.push(e),e=>down.push(e),delegate);ready();turn();
  session.provider({type:'response.function_call_arguments.done',response_id:'response',call_id:'call',arguments:'{"instruction":"Set tempo to 95"}'});
  await vi.waitFor(()=>expect(delegate).toHaveBeenCalledTimes(1));session.provider({type:'input_audio_buffer.speech_started',item_id:'next'});complete({id:'pending',status:'running'});
  await new Promise(resolve=>setTimeout(resolve,25));expect(up.some(e=>e.type==='conversation.item.create')).toBe(false);expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(120);
});
it('reports the captured version conflict without rebasing or invoking a model',async()=>{
  ready();turn();const old=config.llmKey;config.llmKey='configured-only-for-version-check';
  applyCommands(db,p.id,{request_id:'manual',expected_version:p.version,commands:[{type:'project.set_tempo',tempo:80}]},true);
  try{
    session.client({type:'demotif.context',version:getProject(db,p.id).version,context:null});
    session.provider({type:'response.function_call_arguments.done',response_id:'response',call_id:'call',arguments:'{"instruction":"Set tempo to 95"}'});
    await vi.waitFor(()=>expect(up.some(e=>e.type==='conversation.item.create')).toBe(true));
    expect(JSON.stringify(up)).toContain('project changed');expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(80);
    expect(db.all("SELECT id FROM producer_runs WHERE status='running'")).toHaveLength(0);
  }finally{config.llmKey=old;}
});
it('finishing silence does not commit an empty buffer or create a reply',()=>{
  ready();session.client({type:'demotif.finish'});expect(up.filter(e=>e.type==='response.create'||e.type==='input_audio_buffer.commit')).toHaveLength(0);expect(down).toContainEqual({type:'demotif.listening'});
});
it('discards conversation input and late speech during recording hold, then resumes without session setup',()=>{
  ready();turn();const updates=up.filter(e=>e.type==='session.update').length;
  session.client({type:'demotif.hold',active:true});
  const sent=up.length,forwarded=down.length;
  session.client({type:'input_audio_buffer.append',audio:'AAA='});session.provider({type:'input_audio_buffer.speech_started',item_id:'singing'});
  session.provider({type:'conversation.item.input_audio_transcription.completed',item_id:'singing',transcript:'Sung words'});
  session.provider({type:'response.audio.delta',response_id:'response',delta:'AAA='});
  expect(up).toHaveLength(sent);expect(down).toHaveLength(forwarded);expect(JSON.stringify(producerHistory(db,p.id))).not.toContain('Sung words');
  session.client({type:'demotif.hold',active:false});session.client({type:'input_audio_buffer.append',audio:'AAA='});
  expect(up.at(-1)).toMatchObject({type:'input_audio_buffer.append'});expect(up.filter(e=>e.type==='session.update')).toHaveLength(updates);
  expect(up.filter(e=>e.type==='input_audio_buffer.clear')).toHaveLength(2);
});
it('opens once without a fabricated user message or musical operation',async()=>{
  const delegate=vi.fn();session=new RealtimeProducerSession(db,p.id,e=>up.push(e),e=>down.push(e),delegate);
  ready();session.client({type:'demotif.start'});session.client({type:'demotif.start'});
  const openings=up.filter(e=>e.type==='response.create');expect(openings).toHaveLength(1);
  expect(openings[0]).toMatchObject({response:{tool_choice:'none'}});expect(JSON.stringify(openings)).toContain('no meaningful history');
  session.provider({type:'response.created',response:{id:'greeting'}});
  session.provider({type:'response.function_call_arguments.done',response_id:'greeting',call_id:'unexpected',arguments:'{"instruction":"Set tempo to 95"}'});
  session.provider({type:'response.audio_transcript.done',response_id:'greeting',transcript:'你好，今天想做点什么音乐？'});
  expect(delegate).not.toHaveBeenCalled();const history=producerHistory(db,p.id).runs;
  expect(history).toHaveLength(1);expect(history[0].prompt).toBe('');expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(120);
});
it('grounds the opening in recent discussion and drops a late greeting when the user speaks first',()=>{
  ready();turn();session.provider({type:'response.audio_transcript.done',response_id:'response',transcript:'We could try softer drums.'});session.close();
  up=[];down=[];session=new RealtimeProducerSession(db,p.id,e=>up.push(e),e=>down.push(e));ready();session.client({type:'demotif.start'});
  expect(JSON.stringify(up.find(e=>e.type==='response.create'))).toContain('softer drums');
  session.provider({type:'input_audio_buffer.speech_started',item_id:'new-user'});
  session.provider({type:'response.created',response:{id:'late-greeting'}});
  session.provider({type:'response.audio.delta',response_id:'late-greeting',delta:'AAA='});
  expect(down.some(e=>e.type==='response.audio.delta')).toBe(false);
});
it('continues from verified humming after current speech, without a fabricated user message or repeated notification',async()=>{
  const plan:RecordingPlan={segment:'Opening phrase',name:'Humming',target:{kind:'new_track',name:'Ideas'},start_beat:8,end_beat:12,count_in:'none',accompaniment:false,after_recording:'transcribe_notes'};
  db.run("INSERT INTO producer_runs VALUES ('record-run',?,1,'Record the opening phrase','running','[]',NULL,0,'now')",p.id);
  append(db,'record-run',{type:'studio_control',request_id:'record-request',client_id:'browser',expected_version:1,control:{action:'prepare_recording',plan}});
  const b={request_id:'record-request',client_id:'browser'};completeStudioControl(db,p.id,'record-run',{...b,action:'claim'});completeStudioControl(db,p.id,'record-run',{...b,action:'complete'});db.run("UPDATE producer_runs SET status='complete' WHERE id='record-run'");
  const asset=await storeAsset(db,p.id,'humming.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  const take:VocalTake={id:'take',pcm:new Float32Array(48000),sampleRate:24000,startFrame:10000,duration:2,interrupted:false,blob:new Blob()};
  applyCommands(db,p.id,{expected_version:1,request_id:recordingIds('record-request').receipt_id,commands:performanceCommands(take,{projectId:p.id,version:1,origin:8,tempo:120,meter:'4/4',name:'Humming',plan,control:{requestId:'record-request',runId:'record-run',clientId:'browser'}},asset.id)},true);
  completeStudioControl(db,p.id,'record-run',{...b,action:'recording',recording_status:'placed'});
  ready();session.client({type:'demotif.context',version:2,context:null,client_id:'browser'});turn('current-user');
  const result={type:'demotif.recording_result',run_id:'record-run',request_id:'record-request'};
  session.client(result);expect(up.filter(e=>e.type==='response.create')).toHaveLength(0);
  session.provider({type:'input_audio_buffer.speech_stopped'});session.provider({type:'response.done',response:{id:'response',status:'completed'}});
  expect(up.filter(e=>e.type==='response.create')).toHaveLength(1);expect(JSON.stringify(up)).toContain('recording-clip-record-request');
  session.client(result);expect(up.filter(e=>e.type==='response.create')).toHaveLength(1);
  session.provider({type:'response.created',response:{id:'recording-followup'}});session.provider({type:'response.audio_transcript.done',response_id:'recording-followup',transcript:'I have the recorded phrase.'});
  const continuation=producerHistory(db,p.id).runs.find(r=>r.events.some(e=>e.type==='input'&&e.application));
  expect(continuation?.prompt).toBe('');expect(continuation?.events).toContainEqual(expect.objectContaining({type:'context',context:expect.objectContaining({expected_version:2,clip_id:'recording-clip-record-request'})}));
});
