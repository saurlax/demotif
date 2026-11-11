import { z } from 'zod';
import { config } from '../config';
import { audioCapabilitySchema, type AudioCapability } from '@/shared/schema';
import type { AudioRequest } from '../audio-jobs';

const baseURL = 'https://api.elevenlabs.io';
export class AudioProviderError extends Error {}
const modelRows = z.array(z.object({model_id:z.string(),name:z.string(),can_do_text_to_speech:z.boolean().default(false),can_do_voice_conversion:z.boolean().default(false)}));
const voicePage = z.object({voices:z.array(z.object({voice_id:z.string(),name:z.string()})),has_more:z.boolean().default(false),next_page_token:z.string().nullable().optional()});
const timing = z.object({text:z.string(),start:z.number().nonnegative(),end:z.number().nonnegative()}).refine(w=>w.end>=w.start);
export const transcriptSchema = z.object({text:z.string(),words:z.array(timing).default([])});
export type Transcript = z.infer<typeof transcriptSchema>;
let cache:{key:string;expires:number;models:AudioCapability[]}|undefined;

async function request(path:string, init:RequestInit={}, signal?:AbortSignal) {
  if(!config.elevenlabsKey)throw new AudioProviderError('Configure DEMOTIF_ELEVENLABS_API_KEY before using audio models.');
  const headers=new Headers(init.headers);headers.set('xi-api-key',config.elevenlabsKey);
  let response:Response;
  try {response=await fetch(baseURL+path,{...init,headers,signal:signal??AbortSignal.timeout(20000)});}
  catch {if(signal?.aborted)throw signal.reason;throw new AudioProviderError('ElevenLabs connection stopped. The request may have been charged; it will not be retried automatically.');}
  if(!response.ok){
    const body=await response.json().catch(()=>null);
    const code=typeof body?.detail?.status==='string'?body.detail.status:'';
    const reason=/invalid_audio_duration/.test(code)?'The audio duration is outside this ElevenLabs operation’s supported range.':code==='missing_permissions'?'Enable the required permission on the ElevenLabs API key.':
      /credit|quota|balance|payment/i.test(code)||response.status===402?'Check ElevenLabs credits and billing.':
      response.status===401?'Check the ElevenLabs API key and permissions.':
      response.status===403?'Check ElevenLabs account, model and regional access.':
      response.status===429?'ElevenLabs is busy or rate limited.':'Check ElevenLabs model access and request options.';
    throw new AudioProviderError(reason+` (HTTP ${response.status}) The request will not be retried automatically.`);
  }
  return response;
}
async function json(response:Response):Promise<unknown>{
  try{return JSON.parse((await readAudio(response)).toString('utf8'));}
  catch(error){if(error instanceof AudioProviderError)throw error;throw new AudioProviderError('Invalid ElevenLabs response. The request will not be retried.');}
}
export async function readAudio(response:Response):Promise<Buffer>{
  const reader=response.body?.getReader();if(!reader)throw new AudioProviderError('Empty ElevenLabs response.');
  const chunks:Buffer[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;
    if(size>config.maxUpload)throw new AudioProviderError('ElevenLabs response exceeds the media limit.');chunks.push(Buffer.from(next.value));}}
  catch(error){await reader.cancel().catch(()=>{});if(error instanceof AudioProviderError)throw error;throw new AudioProviderError('Incomplete ElevenLabs response; do not resubmit automatically.');}
  if(!size)throw new AudioProviderError('Empty ElevenLabs response.');return Buffer.concat(chunks);
}
function capability(id:string,name:string,category:AudioCapability['category'],minimum:number,maximum:number,reference=false):AudioCapability{
  return audioCapabilitySchema.parse({id,name,provider:'elevenlabs',category,ready:!!config.elevenlabsKey,reason:config.elevenlabsKey?undefined:'Configure DEMOTIF_ELEVENLABS_API_KEY',min_seconds:minimum,max_seconds:maximum,reference_audio:reference});
}
export async function elevenlabsCatalog():Promise<AudioCapability[]>{
  if(cache?.key===config.elevenlabsKey&&cache.expires>Date.now())return structuredClone(cache.models);
  const models=[capability('music_v2_5','Eleven Music v2.5','music',3,300,true),capability('music_v2','Eleven Music v2','music',3,300,true),
    {...capability('eleven_text_to_sound_v3','Sound Effects v3 · One Shot / Loop','sound',0.5,30),loop:true},
    capability('eleven_voice_isolation','Voice Isolation','isolate',4.6,300,true),
    capability('scribe_v2','Scribe v2 · Speech to Text','recognize',0,300,true),
    capability('eleven_forced_alignment','Text / Audio Alignment','align',0,300,true)];
  if(!config.elevenlabsKey)return models;
  // Speech discovery cannot disable music/effects, and voice discovery cannot disable STT.
  const [found,voices]=await Promise.allSettled([
    request('/v1/models').then(json).then(v=>modelRows.parse(v)),
    (async()=>{const rows:{voice_id:string;name:string}[]=[];let token:string|undefined;
      do{const data=voicePage.parse(await json(await request('/v2/voices?page_size=100'+(token?'&next_page_token='+encodeURIComponent(token):''))));
        rows.push(...data.voices);const next=data.has_more?data.next_page_token:undefined;
        if(next&&next===token)throw new AudioProviderError('Invalid ElevenLabs voice pagination.');token=next??undefined;
      }while(token);return [...new Map(rows.map(v=>[v.voice_id,v])).values()];})()
  ]);
  if(found.status==='fulfilled')for(const row of found.value){
    const category=row.can_do_text_to_speech?'speech':row.can_do_voice_conversion?'voice_conversion':undefined;
    if(!category)continue;
    const entry=capability(row.model_id,row.name,category,0,300,category==='voice_conversion');
    entry.voices=voices.status==='fulfilled'?voices.value.map(v=>v.voice_id):[];
    entry.voice_names=voices.status==='fulfilled'?Object.fromEntries(voices.value.map(v=>[v.voice_id,v.name])):{};
    entry.ready=entry.voices.length>0;
    entry.reason=entry.ready?undefined:'Enable Voices read access and provide an accessible voice.';models.push(entry);
  }
  else models.push({...capability('eleven_speech_catalog','ElevenLabs speech models','speech',0,300),ready:false,reason:'Enable Models access to discover speech models.'});
  cache={key:config.elevenlabsKey,expires:Date.now()+60000,models};return structuredClone(models);
}
export function validateElevenlabsRequest(input:AudioRequest,model:AudioCapability){
  if(!model.ready||model.category!==input.mode)throw new AudioProviderError('Selected ElevenLabs model is unavailable for this operation.');
  if(input.duration_seconds<model.min_seconds||input.duration_seconds>model.max_seconds)throw new AudioProviderError(`Choose a duration from ${model.min_seconds} to ${model.max_seconds} seconds.`);
  if(input.vocal_only||input.exclude)throw new AudioProviderError('Guaranteed isolated vocals and negative tags are not supported by this request.');
  if(input.reference&&(!model.reference_audio||input.mode!=='music'))throw new AudioProviderError('This model does not support music reference conditioning.');
  if(input.loop&&(!model.loop||input.mode!=='sound'))throw new AudioProviderError('Seamless loop mode is supported only for sound effects.');
  if(['speech','voice_conversion'].includes(input.mode)&&!model.voices.includes(input.voice))throw new AudioProviderError('Choose an accessible ElevenLabs voice.');
  if(['music','speech','sound'].includes(input.mode)&&input.source_id)throw new AudioProviderError('This model does not accept audio reference conditioning. Use a descriptive prompt or faithful Clip rendering.');
}
function audioForm(bytes:Buffer,field='audio'){
  const form=new FormData();form.set(field,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),'input.wav');return form;
}
export async function transcribeElevenlabs(bytes:Buffer,signal:AbortSignal):Promise<Transcript>{
  const form=audioForm(bytes,'file');form.set('model_id','scribe_v2');form.set('tag_audio_events','false');form.set('timestamps_granularity','word');
  return transcriptSchema.parse(await json(await request('/v1/speech-to-text',{method:'POST',body:form},signal)));
}
export async function alignElevenlabs(bytes:Buffer,text:string,signal:AbortSignal):Promise<Transcript>{
  const form=audioForm(bytes,'file');form.set('text',text);
  const aligned=z.object({words:z.array(timing)}).parse(await json(await request('/v1/forced-alignment',{method:'POST',body:form},signal)));
  return {text,words:aligned.words};
}
export async function generateElevenlabs(input:AudioRequest,signal:AbortSignal,onIdentity:(id:string)=>void,source?:Buffer):Promise<Buffer>{
  const model=(await elevenlabsCatalog()).find(m=>m.id===input.model&&m.category===input.mode);
  if(!model)throw new AudioProviderError('Selected ElevenLabs model is unavailable.');validateElevenlabsRequest(input,model);
  let path:string,body:BodyInit,headers:HeadersInit|undefined;
  if(input.mode==='music'){
    path='/v1/music?output_format=mp3_44100_128';
    const common={model_id:input.model};
    // A single v2 chunk is at most 120 s; split long lyrics across documented chunks.
    const count=Math.ceil(input.duration_seconds/120),lines=input.lyrics.split('\n');
    let reference: {song_id:string;range:{start_ms:number;end_ms:number}}|undefined;
    if(input.reference){
      if(!source)throw new AudioProviderError('Reference audio is unavailable.');
      const upload=await request('/v1/music/upload',{method:'POST',body:audioForm(source,'file')},signal);
      const song=z.object({song_id:z.string().min(1)}).parse(await json(upload));
      onIdentity('reference:'+song.song_id);
      reference={song_id:song.song_id,range:{start_ms:0,end_ms:Math.round(input.reference.duration_seconds*1000)}};
    }
    body=JSON.stringify(input.instrumental&&!reference?{...common,prompt:input.prompt,music_length_ms:Math.round(input.duration_seconds*1000),force_instrumental:true}:
      {...common,composition_plan:{chunks:Array.from({length:count},(_,i)=>({text:input.instrumental?'[Instrumental]':lines.slice(Math.floor(i*lines.length/count),Math.floor((i+1)*lines.length/count)).join('\n'),duration_ms:Math.round(input.duration_seconds*1000/count),positive_styles:[input.prompt,...(input.instrumental?['instrumental']:[])],negative_styles:input.instrumental?['vocals']:[],...(reference&&i===0?{conditioning_ref:reference,condition_strength:input.reference_strength}:{} )}))}});

  }else if(input.mode==='sound'){
    path='/v1/sound-generation?output_format=mp3_44100_128';body=JSON.stringify({text:input.prompt,model_id:input.model,duration_seconds:input.duration_seconds,loop:input.loop});
  }else if(input.mode==='speech'){
    path=`/v1/text-to-speech/${encodeURIComponent(input.voice)}?output_format=mp3_44100_128`;body=JSON.stringify({text:input.prompt,model_id:input.model});
  }else if(input.mode==='voice_conversion'||input.mode==='isolate'){
    if(!source)throw new AudioProviderError('Choose an owned audio Clip.');
    path=input.mode==='isolate'?'/v1/audio-isolation':`/v1/voice-changer/${encodeURIComponent(input.voice)}?output_format=mp3_44100_128`;
    const form=audioForm(source);if(input.mode==='voice_conversion')form.set('model_id',input.model!);body=form;
  }else throw new AudioProviderError('Unsupported ElevenLabs audio operation.');
  if(typeof body==='string')headers={'Content-Type':'application/json'};
  const response=await request(path,{method:'POST',headers,body},signal);
  const id=response.headers.get('request-id')??response.headers.get('x-request-id')??response.headers.get('history-item-id');if(id)onIdentity(id);
  const type=response.headers.get('content-type')??'';
  if(!/^(audio\/|application\/octet-stream)/i.test(type))throw new AudioProviderError('ElevenLabs returned a non-audio response; do not resubmit automatically.');
  return readAudio(response);
}
