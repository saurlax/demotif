import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {Store} from './db';
import {handle} from './api';
import {createProject,getProject,applyCommands} from './projects';
import {storeAsset} from './media';
import {pcmWave} from './audio-providers/pcm';
import {config} from './config';
import {ensureAudio,audioProposal,type AudioRow} from './audio-jobs';
const fixture=vi.hoisted(()=>({runtime:undefined as unknown}));
vi.mock('./db',async original=>({...await original<typeof import('./db')>(),runtime:async()=>fixture.runtime}));
vi.mock('./audio-providers/modal-media',()=>({
  processModalAudio: async (operation: string, input: Buffer, params: { duration: number }) => {
    const duration = input.readUInt32LE(40) / input.readUInt32LE(28);
    if (operation === 'probe') return { duration };
    if (operation === 'normalize') return { duration, audio: input };
    if (operation === 'excerpt') return { audio: Buffer.alloc(Math.round(params.duration * 44100) * 4) };
    throw new Error(`Unexpected media operation: ${operation}`);
  },
}));
let db:Store,upstream:string,mediaApp:string;
beforeEach(()=>{db=new Store(':memory:');fixture.runtime={store:db,producerTasks:new Map(),audioTasks:new Map()};upstream=config.upstream;config.upstream='';mediaApp=config.mediaModal.app;config.mediaModal.app='test-media'});
afterEach(()=>{db.db.close();config.upstream=upstream;config.mediaModal.app=mediaApp});
const post=(path:string,value:unknown)=>handle(new Request(`http://localhost/api${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}));
it('registers a rendered Clip, preserves its original and atomically places reviewed audio on a new track',async()=>{
  const p=createProject(db,'Draft',{sources:[{id:'score',name:'Melody',kind:'notes',duration:4,notes:[]}],tracks:[{id:'t',name:'Keys',clips:[{id:'c',name:'Melody',source_id:'score',kind:'midi',start_beat:8,length_beats:4}]}]},true);
  const bytes=pcmWave(Buffer.alloc(48000),24000,1),asset=await storeAsset(db,p.id,'render.wav','audio/wav',bytes);
  const context={expected_version:1,track_id:'t',clip_id:'c',start_beat:8,offset_seconds:0};
  const registered=await post(`/projects/${p.id}/audio-renders`,{asset_id:asset.id,name:'Rendered',context});expect(registered.status).toBe(200);const job=await registered.json();expect(getProject(db,p.id).version).toBe(1);
  const reviewed=await post(`/projects/${p.id}/audio-jobs/${job.id}/review`,{context});expect(reviewed.status).toBe(200);
  const accepted=await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context,request_id:'render-accept'});expect(accepted.status).toBe(200);const {project}=await accepted.json();expect(project.version).toBe(2);expect(project.document.tracks).toHaveLength(2);expect(project.document.tracks[0].clips[0].id).toBe('c');expect(project.document.tracks[1].clips[0].start_beat).toBe(8);expect(project.document.tracks[1].clips[0].length_beats).toBeCloseTo(2);
  const again=await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context,request_id:'render-accept'});expect((await again.json()).project.version).toBe(2);
});
it('retains a completed render after a version change and requires explicit retargeting',async()=>{
  const p=createProject(db,'Draft',{},true),asset=await storeAsset(db,p.id,'render.wav','audio/wav',pcmWave(Buffer.alloc(4800),24000,1));
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'project.set_tempo',tempo:100}]});
  const context={expected_version:1,track_id:null,clip_id:null,start_beat:4,offset_seconds:0};
  const registered=await post(`/projects/${p.id}/audio-renders`,{asset_id:asset.id,name:'Rendered',context});expect(registered.status).toBe(200);const job=await registered.json();
  expect((await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context,request_id:'stale'})).status).toBe(409);
  expect((await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context:{...context,expected_version:2},request_id:'current'})).status).toBe(200);
});

async function remoteSetup(failure=false){
  const original=config.elevenlabsKey;config.elevenlabsKey='workflow-'+crypto.randomUUID();
  const wav=pcmWave(Buffer.alloc(48000),24000,1);
  const send=vi.fn(async(url:string,_init?:RequestInit)=>{
    if(url.endsWith('/v1/models'))return Response.json([]);
    if(url.includes('/v2/voices'))return Response.json({voices:[],has_more:false});
    if(url.endsWith('/v1/speech-to-text'))return Response.json({text:'Synthetic fixture',words:[{text:'Synthetic',start:0,end:0.2}]});
    if(url.endsWith('/v1/music/upload'))return Response.json({song_id:'uploaded-song'});
    if(failure)return Response.json({detail:{status:'missing_permissions',message:'secret-upstream-value'}},{status:401});
    return new Response(new Uint8Array(wav),{headers:{'content-type':'audio/wav','request-id':'paid-once'}});
  });
  vi.stubGlobal('fetch',send);return {send,restore:()=>{config.elevenlabsKey=original;vi.unstubAllGlobals();},wav};
}
async function finished(id:string){
  await vi.waitFor(()=>expect(db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=?',id)?.status).toMatch(/complete|failed|interrupted/),{timeout:10000});
  return db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=?',id)!;
}
it('publishes direct ElevenLabs audio once and retains explicit atomic acceptance',async()=>{
  const remote=await remoteSetup();
  try{
    const p=createProject(db,'Audio draft',{},true),context={expected_version:1,track_id:null,clip_id:null,start_beat:8,offset_seconds:0};
    const input={mode:'music',model:'music_v2_5',name:'Generated',prompt:'Solo piano',duration_seconds:3,context};
    const first=await ensureAudio(db,p.id,input),job=await finished(first.id);
    expect(job.status).toBe('complete');expect(job.upstream_id).toBe('paid-once');expect(getProject(db,p.id).version).toBe(1);
    expect((await ensureAudio(db,p.id,input)).id).toBe(job.id);
    expect(remote.send.mock.calls.filter(([url])=>url.includes('/v1/music?'))).toHaveLength(1);
    const accepted=await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context,request_id:'remote-accept'});
    expect(accepted.status).toBe(200);const result=await accepted.json();
    expect(result.project.version).toBe(2);expect(result.project.document.tracks[0].clips[0].start_beat).toBe(8);
  }finally{remote.restore();}
});
it('persists recognition as text without inventing note sources or permitting Apply',async()=>{
  const remote=await remoteSetup();
  try{
    const p=createProject(db,'Recognition draft',{},true),asset=await storeAsset(db,p.id,'fixture.wav','audio/wav',remote.wav);
    applyCommands(db,p.id,{expected_version:1,commands:[{type:'source.add',source:{id:'input-source',name:'Input',kind:'audio',asset_id:asset.id,duration:1}}]});
    const context={expected_version:2,track_id:null,clip_id:null,source_id:'input-source',start_beat:0,offset_seconds:0.2,duration_seconds:0.5};
    const job=await finished((await ensureAudio(db,p.id,{mode:'recognize',model:'scribe_v2',context})).id);
    expect(job.status).toBe('complete');expect(JSON.parse(job.results)[0].transcript.text).toBe('Synthetic fixture');
    expect(getProject(db,p.id).version).toBe(2);
    expect((await post(`/projects/${p.id}/audio-jobs/${job.id}/accept`,{context,request_id:'text-not-a-clip'})).status).toBe(422);
    await expect(ensureAudio(db,p.id,{mode:'recognize',model:'scribe_v2',context:{...context,offset_seconds:0.8}})).rejects.toThrow('audio range');
  }finally{remote.restore();}
});
it('retains a failed paid request and never retries or exposes the raw error',async()=>{
  const remote=await remoteSetup(true);
  try{
    const p=createProject(db,'Failure draft',{},true),input={mode:'sound',model:'eleven_text_to_sound_v3',prompt:'One drum hit',duration_seconds:1};
    const job=await finished((await ensureAudio(db,p.id,input)).id);
    expect(job.status).toBe('failed');expect(job.error).toContain('required permission');expect(job.error).not.toContain('secret-upstream-value');
    expect((await ensureAudio(db,p.id,input)).id).toBe(job.id);
    expect(remote.send.mock.calls.filter(([url])=>url.includes('/v1/sound-generation?'))).toHaveLength(1);
  }finally{remote.restore();}
});

it('rejects unowned or out-of-range musical references without paid submission',async()=>{
 const remote=await remoteSetup();
 try{
  const p=createProject(db,'Reference draft',{},true);
  await expect(ensureAudio(db,p.id,{mode:'music',model:'music_v2_5',prompt:'Jazz',reference:{source_id:'foreign',duration_seconds:1},reference_source_snapshot:{id:'foreign',name:'Fake',kind:'audio',duration:5,asset_id:'foreign'}})).rejects.toThrow('owned audio reference');
  const asset=await storeAsset(db,p.id,'reference.wav','audio/wav',remote.wav);
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'source.add',source:{id:'ref',name:'Reference',kind:'audio',asset_id:asset.id,duration:1}}]});
  await expect(ensureAudio(db,p.id,{mode:'music',model:'music_v2_5',prompt:'Jazz',reference:{source_id:'ref',offset_seconds:0.8,duration_seconds:0.5}})).rejects.toThrow('reference excerpt');
  expect(remote.send.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 }finally{remote.restore();}
});
it('keeps staged analysis placement identities stable after persisting its editable source',()=>{
 const p=createProject(db,'Analysis draft',{},true),context={expected_version:1,track_id:null,clip_id:null,start_beat:12,offset_seconds:0};
 const job:AudioRow={id:'stable-analysis',project_id:p.id,status:'complete',request:JSON.stringify({mode:'transcribe',source_id:'input'}),upstream_id:null,error:null,created_at:'now',results:JSON.stringify([{name:'Notes',analysis:{duration:1,notes:[{pitch:60,start:0,duration:0.5,velocity:0.8}]}}])};
 const original=audioProposal(db,p.id,job,context);const source=original.find(c=>c.type==='source.add')!;
 if(source.type!=='source.add')throw Error('Expected source');
 job.results=JSON.stringify([{name:'Notes',source:source.source,analysis:{duration:1,notes:[{pitch:60,start:0,duration:0.5,velocity:0.8}]}}]);
 expect(audioProposal(db,p.id,job,context)).toEqual(original);
});

it('repeats short musical references only for upload and keeps the original conditioning range',async()=>{
 const remote=await remoteSetup();
 try{
  const p=createProject(db,'Short reference',{},true),asset=await storeAsset(db,p.id,'reference.wav','audio/wav',remote.wav);
  applyCommands(db,p.id,{expected_version:1,commands:[{type:'source.add',source:{id:'ref',name:'Reference',kind:'audio',asset_id:asset.id,duration:1}}]});
  const job=await finished((await ensureAudio(db,p.id,{mode:'music',model:'music_v2_5',prompt:'Jazz guitar',duration_seconds:3,reference:{source_id:'ref',duration_seconds:1}})).id);
  expect(job.status).toBe('complete');expect(JSON.parse(job.request).reference_preparation).toBe('repeat_to_minimum');
  const upload=remote.send.mock.calls.find(([url])=>url.endsWith('/v1/music/upload'))!;
  const file=(upload[1]!.body as FormData).get('file') as File,bytes=Buffer.from(await file.arrayBuffer());
  expect(bytes.readUInt32LE(40)/bytes.readUInt32LE(28)).toBe(10);
  const generation=remote.send.mock.calls.find(([url])=>url.includes('/v1/music?'))!;
  const body=JSON.parse(generation[1]!.body as string);
  expect(JSON.stringify(body)).toContain('"end_ms":1000');
  expect(remote.send.mock.calls.filter(([url])=>url.endsWith('/v1/music/upload'))).toHaveLength(1);
  expect(getProject(db,p.id).version).toBe(2);
 }finally{remote.restore();}
});
