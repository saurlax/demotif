import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {MockLanguageModelV4} from 'ai/test';
import {Store} from './db';
import {createProject,getProject,applyCommands} from './projects';
import {startProducer,requireRun,append} from './producer';
import {completeBrowserRender,selectedAudioReference} from './producer-render';
import {storeAsset} from './media';
import {pcmWave} from './audio-providers/pcm';
const state=vi.hoisted(()=>({runtime:undefined as unknown}));
vi.mock('./db',async original=>({...await original<typeof import('./db')>(),runtime:async()=>state.runtime}));
vi.mock('./audio-providers/modal-media',()=>({
  processModalAudio: async (operation: string, input: Buffer) => {
    expect(operation).toBe('probe');
    return { duration: input.readUInt32LE(40) / input.readUInt32LE(28) };
  },
}));
let db:Store;
beforeEach(()=>{db=new Store(':memory:');state.runtime={store:db,producerTasks:new Map(),audioTasks:new Map()};});
afterEach(()=>db.db.close());
function fixture(){return createProject(db,'Render draft',{sources:[{id:'s',kind:'notes',name:'Current sampler',duration:4,sound:'piano',notes:[{id:'n',pitch:60,start:0,duration:1,velocity:0.8}]}],tracks:[{id:'t',name:'Notes',clips:[{id:'c',source_id:'s',kind:'midi',start_beat:8,length_beats:4}]}]},true);}
const context={expected_version:1,track_id:'t',clip_id:'c',start_beat:8,offset_seconds:0,duration_seconds:2};
function request(p:string,run='run'){
  db.run("INSERT INTO producer_runs(id,project_id,base_version,prompt,status,commands,state,applied,created_at) VALUES (?,?,1,'Render','running','[]',NULL,0,'now')",run,p);
  append(db,run,{type:'client_render',request_id:'render-request',context,name:'Sound'});
}
it('claims, completes and deduplicates a browser render without applying project edits',async()=>{
  const p=fixture();request(p.id);
  const body={request_id:'render-request',client_id:'browser'};
  expect(await completeBrowserRender(db,p.id,'run',{...body,action:'claim'},AbortSignal.timeout(5000))).toEqual({status:'claimed'});
  expect(await completeBrowserRender(db,p.id,'run',{...body,client_id:'second',action:'claim'},AbortSignal.timeout(5000))).toEqual({status:'claimed_elsewhere'});
  const asset=await storeAsset(db,p.id,'render.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  const first=await completeBrowserRender(db,p.id,'run',{...body,action:'complete',asset_id:asset.id},AbortSignal.timeout(5000));
  expect(first.status).toBe('complete');expect((await completeBrowserRender(db,p.id,'run',{...body,action:'complete',asset_id:asset.id},AbortSignal.timeout(5000)))).toEqual(first);
  expect(db.all("SELECT * FROM producer_events WHERE json_extract(payload,'$.type')='client_render_result'")).toHaveLength(1);
  expect(getProject(db,p.id).version).toBe(1);
});
it('rejects a foreign asset, stale claim and a stopped run',async()=>{
  const p=fixture(),other=createProject(db,'Other',{},true);request(p.id);const body={request_id:'render-request',client_id:'browser'};
  await completeBrowserRender(db,p.id,'run',{...body,action:'claim'},AbortSignal.timeout(5000));
  const foreign=await storeAsset(db,other.id,'foreign.wav','audio/wav',pcmWave(Buffer.alloc(9600),24000,1));
  await expect(completeBrowserRender(db,p.id,'run',{...body,action:'complete',asset_id:foreign.id},AbortSignal.timeout(5000))).rejects.toThrow('does not belong');
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'project.set_tempo',tempo:90}]});
  await expect(completeBrowserRender(db,p.id,'run',{...body,action:'claim'},AbortSignal.timeout(5000))).rejects.toThrow();
  db.run("UPDATE producer_runs SET status='cancelled' WHERE id='run'");
  await expect(completeBrowserRender(db,p.id,'run',{...body,action:'complete',asset_id:foreign.id},AbortSignal.timeout(5000))).rejects.toThrow('no longer');
});
it('carries actual note/instrument context without inventing audio timbre',()=>{
  const p=fixture();expect(selectedAudioReference(db,p.id,context).source).toMatchObject({sound:'piano',notes:[{id:'n',pitch:60}]});
});
it('lets the actual agent tool await browser output and stage placement for approval',async()=>{
  const p=fixture();let step=0;
  const model=new MockLanguageModelV4({doStream:async()=>({stream:new ReadableStream({start(c){
    if(step++===0)c.enqueue({type:'tool-call',toolCallId:'render',toolName:'render_clip',input:JSON.stringify({name:'Rendered piano'})});
    else{c.enqueue({type:'text-start',id:'reply'});c.enqueue({type:'text-delta',id:'reply',delta:'Ready for review.'});c.enqueue({type:'text-end',id:'reply'});}
    c.enqueue({type:'finish',finishReason:{unified:step===1?'tool-calls':'stop',raw:step===1?'tool_calls':'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}});c.close();
  }})})});
  await startProducer(db,p.id,{id:'agent-render',text:'Turn this Clip into Sound',expected_version:1,context},model);
  let payload:{request_id:string}|undefined;
  await vi.waitFor(()=>{const row=db.get<{payload:string}>("SELECT payload FROM producer_events WHERE run_id='agent-render' AND json_extract(payload,'$.type')='client_render'");expect(row).toBeDefined();payload=JSON.parse(row!.payload);},{timeout:5000});
  const body={request_id:payload!.request_id,client_id:'browser'};
  await completeBrowserRender(db,p.id,'agent-render',{...body,action:'claim'},AbortSignal.timeout(5000));
  const asset=await storeAsset(db,p.id,'render.wav','audio/wav',pcmWave(Buffer.alloc(96000),24000,1));
  await completeBrowserRender(db,p.id,'agent-render',{...body,action:'complete',asset_id:asset.id},AbortSignal.timeout(5000));
  await vi.waitFor(()=>expect(requireRun(db,p.id,'agent-render').status).toBe('complete'),{timeout:5000});
  const commands=JSON.parse(requireRun(db,p.id,'agent-render').commands);
  expect(commands).toContainEqual(expect.objectContaining({type:'clip.add',start_beat:8,kind:'audio'}));
  expect(getProject(db,p.id).version).toBe(2);expect(requireRun(db,p.id,'agent-render').applied).toBe(1);expect(commands.some((c:{type:string})=>c.type==='clip.remove')).toBe(false);
});
