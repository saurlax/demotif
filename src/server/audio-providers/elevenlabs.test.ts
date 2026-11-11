import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {config} from '../config';
import {audioRequestSchema} from '../audio-jobs';
import {elevenlabsCatalog,generateElevenlabs,transcribeElevenlabs,alignElevenlabs} from './elevenlabs';
import {pcmWave} from './pcm';

let sequence=0;
const original={key:config.elevenlabsKey,llm:config.llmKey,url:config.llmURL};
const calls:{url:string;init?:RequestInit}[]=[];
let fail:string|undefined;
beforeEach(()=>{
  config.elevenlabsKey=`audio-test-${++sequence}`;config.llmKey='DO-NOT-USE-LLM';config.llmURL='https://llm.invalid/v1';calls.length=0;fail=undefined;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    if(fail&&url.includes(fail))return Response.json({detail:{status:'missing_permissions',message:'DO-NOT-EXPOSE-RAW-SECRET'}},{status:401});
    if(url.endsWith('/v1/models'))return Response.json([{model_id:'eleven_v4_turbo',name:'Speech',can_do_text_to_speech:true},{model_id:'eleven_multilingual_sts_v2',name:'Voice',can_do_voice_conversion:true}]);
    if(url.includes('/v2/voices'))return Response.json({voices:[{voice_id:'voice-1',name:'Voice'}],has_more:false});
    if(url.endsWith('/v1/music/upload'))return Response.json({song_id:'uploaded-song'});
    if(url.endsWith('/v1/speech-to-text'))return Response.json({text:'Hello',words:[{text:'Hello',start:0,end:0.5,type:'word'}]});
    if(url.endsWith('/v1/forced-alignment'))return Response.json({words:[{text:'Hello',start:0,end:0.5}]});
    return new Response(new Uint8Array(pcmWave(Buffer.alloc(9600),24000,1)),{headers:{'Content-Type':'audio/wav','request-id':'upstream-identity'}});
  });
});
afterEach(()=>{config.elevenlabsKey=original.key;config.llmKey=original.llm;config.llmURL=original.url;vi.unstubAllGlobals();});
const input=(value:Record<string,unknown>)=>audioRequestSchema.parse({prompt:'Warm solo piano',...value});
const signal=()=>new AbortController().signal;
const posts=()=>calls.filter(c=>c.init?.method==='POST');

it('discovers categorized audio without the LLM credential and never exposes keys',async()=>{
  config.llmKey='';const catalog=await elevenlabsCatalog();
  expect(new Set(catalog.map(m=>m.category))).toEqual(new Set(['music','sound','speech','voice_conversion','isolate','recognize','align']));
  expect(catalog.find(m=>m.category==='sound')?.loop).toBe(true);
  expect(catalog.find(m=>m.category==='speech')?.voices).toEqual(['voice-1']);
  expect(calls.every(c=>c.url.startsWith('https://api.elevenlabs.io/'))).toBe(true);
  expect(calls.every(c=>new Headers(c.init?.headers).get('xi-api-key')===config.elevenlabsKey)).toBe(true);
  expect(JSON.stringify(catalog)).not.toContain(config.elevenlabsKey);
});
it('keeps music and recognition independent of voice/model permission failures',async()=>{
  fail='/v2/voices';const catalog=await elevenlabsCatalog();
  expect(catalog.find(m=>m.category==='speech')?.ready).toBe(false);
  expect(catalog.find(m=>m.category==='music')?.ready).toBe(true);
  expect(catalog.find(m=>m.category==='recognize')?.ready).toBe(true);
});
it('returns unavailable capabilities without sending requests when no audio key exists',async()=>{
  config.elevenlabsKey='';expect((await elevenlabsCatalog()).every(m=>!m.ready)).toBe(true);expect(calls).toHaveLength(0);
});
it('sends instrumental music to the direct music endpoint and records upstream identity',async()=>{
  const identity=vi.fn();await generateElevenlabs(input({mode:'music',model:'music_v2_5',duration_seconds:3}),signal(),identity);
  const call=posts()[0];expect(call.url).toContain('/v1/music?');expect(JSON.parse(String(call.init?.body))).toEqual({model_id:'music_v2_5',prompt:'Warm solo piano',music_length_ms:3000,force_instrumental:true});
  expect(identity).toHaveBeenCalledWith('upstream-identity');
});
it('preserves supplied lyrics with v2 chunks, splitting at the documented chunk duration',async()=>{
  await generateElevenlabs(input({mode:'music',model:'music_v2',duration_seconds:240,instrumental:false,lyrics:'[Verse]\n你好\n[Chorus]\n世界'}),signal(),()=>{});
  const body=JSON.parse(String(posts()[0].init?.body));expect(body.prompt).toBeUndefined();expect(body.force_instrumental).toBeUndefined();
  expect(body.composition_plan.chunks).toHaveLength(2);expect(body.composition_plan.chunks.every((c:{duration_ms:number})=>c.duration_ms===120000)).toBe(true);
  expect(body.composition_plan.chunks.map((c:{text:string})=>c.text).join('\n')).toBe('[Verse]\n你好\n[Chorus]\n世界');
});
it('passes a real seamless-loop flag to SFX v3',async()=>{
  await generateElevenlabs(input({mode:'sound',model:'eleven_text_to_sound_v3',loop:true,duration_seconds:8}),signal(),()=>{});
  expect(JSON.parse(String(posts()[0].init?.body))).toMatchObject({loop:true,duration_seconds:8,model_id:'eleven_text_to_sound_v3'});
});
it('uses discovered TTS and voice conversion models with validated voices',async()=>{
  await generateElevenlabs(input({mode:'speech',model:'eleven_v4_turbo',voice:'voice-1'}),signal(),()=>{});
  await generateElevenlabs(input({mode:'voice_conversion',model:'eleven_multilingual_sts_v2',voice:'voice-1',source_id:'owned'}),signal(),()=>{},pcmWave(Buffer.alloc(9600),24000,1));
  expect(posts()[0].url).toContain('/text-to-speech/voice-1');expect(posts()[1].url).toContain('/voice-changer/voice-1');
  expect((posts()[1].init!.body as FormData).get('model_id')).toBe('eleven_multilingual_sts_v2');
  expect((posts()[1].init!.body as FormData).get('audio')).toBeInstanceOf(Blob);
});
it('uses isolation rather than advertising full music stem separation',async()=>{
  await generateElevenlabs(input({mode:'isolate',model:'eleven_voice_isolation',source_id:'owned'}),signal(),()=>{},Buffer.from('wav'));
  expect(posts()[0].url.endsWith('/v1/audio-isolation')).toBe(true);
});
it('uploads multipart audio for recognition and validates alignment timestamps',async()=>{
  expect(await transcribeElevenlabs(Buffer.from('wav'),signal())).toEqual({text:'Hello',words:[{text:'Hello',start:0,end:0.5}]});
  expect((posts()[0].init!.body as FormData).get('model_id')).toBe('scribe_v2');
  expect(await alignElevenlabs(Buffer.from('wav'),'Hello',signal())).toEqual({text:'Hello',words:[{text:'Hello',start:0,end:0.5}]});
  expect((posts()[1].init!.body as FormData).get('text')).toBe('Hello');
});
it.each([
  {mode:'speech',model:'eleven_v4_turbo',voice:'unavailable'},
  {mode:'music',model:'music_v2',loop:true},
  {mode:'music',model:'music_v2',source_id:'unsupported-reference'},
  {mode:'music',model:'music_v2',vocal_only:true,instrumental:false,lyrics:'x'},
  {mode:'sound',model:'retired'},
])('rejects unsupported controls before paid submission: %j',async value=>{
  await expect(generateElevenlabs(input(value),signal(),()=>{})).rejects.toThrow();expect(posts()).toHaveLength(0);
});
it('sanitizes permission errors and makes exactly one paid attempt',async()=>{
  fail='/v1/music';await expect(generateElevenlabs(input({mode:'music',model:'music_v2'}),signal(),()=>{})).rejects.toThrow('Enable the required permission');
  expect(posts()).toHaveLength(1);
});
it('rejects JSON and truncated responses rather than returning them as audio',async()=>{
  await elevenlabsCatalog();vi.stubGlobal('fetch',async()=>Response.json({audio:'not-audio'}));
  await expect(generateElevenlabs(input({mode:'sound',model:'eleven_text_to_sound_v3',duration_seconds:1}),signal(),()=>{})).rejects.toThrow('non-audio');
  vi.stubGlobal('fetch',async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new Error('raw-secret'));}}),{headers:{'Content-Type':'audio/mpeg'}}));
  await expect(generateElevenlabs(input({mode:'sound',model:'eleven_text_to_sound_v3',duration_seconds:1}),signal(),()=>{})).rejects.toThrow('Incomplete');
});
it('passes cancellation to the actual generation request without replay',async()=>{
  const controller=new AbortController();await elevenlabsCatalog();vi.stubGlobal('fetch',async(_url:string,init?:RequestInit)=>{expect(init?.signal).toBe(controller.signal);controller.abort();throw controller.signal.reason;});
  await expect(generateElevenlabs(input({mode:'music',model:'music_v2'}),controller.signal,()=>{})).rejects.toBeDefined();
});

it('uploads real reference bytes and conditions music on the explicit excerpt once',async()=>{
  const identity=vi.fn();const bytes=pcmWave(Buffer.alloc(48000),24000,1);
  await generateElevenlabs(input({mode:'music',model:'music_v2_5',duration_seconds:3,reference:{source_id:'owned-reference',offset_seconds:2,duration_seconds:1},reference_strength:'medium'}),signal(),identity,bytes);
  expect(posts()).toHaveLength(2);expect(posts()[0].url).toContain('/v1/music/upload');
  expect((posts()[0].init!.body as FormData).get('file')).toBeInstanceOf(Blob);
  const chunk=JSON.parse(String(posts()[1].init?.body)).composition_plan.chunks[0];
  expect(chunk.conditioning_ref).toEqual({song_id:'uploaded-song',range:{start_ms:0,end_ms:1000}});
  expect(chunk.condition_strength).toBe('medium');expect(identity.mock.calls[0]).toEqual(['reference:uploaded-song']);
});
it('does not fall back to prompt-only music after a reference upload fails',async()=>{
  fail='/v1/music/upload';
  await expect(generateElevenlabs(input({mode:'music',model:'music_v2',reference:{source_id:'owned',duration_seconds:1}}),signal(),()=>{},Buffer.from('audio'))).rejects.toThrow('permission');
  expect(posts()).toHaveLength(1);expect(posts()[0].url).toContain('/upload');
});
it('does not repeat a charged upload or generation when conditioned generation fails',async()=>{
  fail='/v1/music?';const identity=vi.fn();
  await expect(generateElevenlabs(input({mode:'music',model:'music_v2',reference:{source_id:'owned',duration_seconds:1}}),signal(),identity,Buffer.from('audio'))).rejects.toThrow();
  expect(posts()).toHaveLength(2);expect(identity).toHaveBeenCalledExactlyOnceWith('reference:uploaded-song');
});
