import {pcmWave} from './audio-providers/pcm';
import { pythonJSON, sha256Text } from "./compatibility";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { config } from "./config";
import { processModalAudio } from "./audio-providers/modal-media";
import { runtime, type Store } from "./db";
import { getProject, readProject, now, applyCommands, type AssetRow } from "./projects";
import { conflict } from './errors';
import { commandSchema, partSchema, type Command, type AudioContext } from '@/shared/schema';
import { sourceSchema, documentSchema, audioContextSchema, type AudioCapability } from "@/shared/schema";
import { generateElevenlabs, elevenlabsCatalog, validateElevenlabsRequest, transcribeElevenlabs, alignElevenlabs, AudioProviderError, type Transcript } from './audio-providers/elevenlabs';
import { voiceCatalog } from './vocals/profiles';
import { binaries } from './storage';
import { ApiError, invalid } from "./errors";
import { materializeAsset, prepareAsset, publishAsset } from "./media";
import { Slots } from "./jobs";

export const audioRequestSchema = z
  .strictObject({
    mode: z.enum(["music", "speech", "sound", "separate", "transcribe", "voice_conversion", "isolate", "recognize", "align"]),
    provider: z.enum(['elevenlabs','local','openrouter']).optional(),
    model: z.string().max(160).optional(),
    context: audioContextSchema.optional(),
    source_snapshot: sourceSchema.optional(),
    reference:z.object({source_id:z.string(),offset_seconds:z.number().nonnegative().default(0),duration_seconds:z.number().min(0.05).max(30)}).optional(),
    reference_source_snapshot:sourceSchema.optional(),
    reference_only:z.boolean().default(false),
    reference_preparation:z.enum(['original','repeat_to_minimum']).default('original'),
    reference_strength:z.enum(['low','medium','high','xhigh']).default('high'),
    name: z.string().min(1).max(80).default("New audio"),
    prompt: z.string().max(1000).default(""),
    duration_seconds: z.number().min(0).max(300).default(30),
    lyrics: z.string().max(2000).default(""),
    instrumental: z.boolean().default(true),
    loop: z.boolean().default(false),
    vocal_only: z.boolean().default(false),
    exclude: z.string().max(1000).default(""),
    voice: z.string().max(80).default(""),
    source_id: z.string().nullable().default(null),
    take: z.number().int().min(1).max(1000).default(1),
    analysis_mode: z.enum(["pitched", "percussion"]).default("pitched"),
    min_pitch: z.number().int().min(21).max(107).default(28),
    max_pitch: z.number().int().min(22).max(108).default(84),
    drum_pitch: z.number().int().min(0).max(127).default(42),
  })
  .superRefine((r, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (["separate", "transcribe", "voice_conversion", "isolate", "recognize", "align"].includes(r.mode)) {
      if ((!r.source_id && !(r.context?.clip_id||r.context?.source_id)) || r.min_pitch >= r.max_pitch)
        fail("Select a source and valid pitch range");
      if(r.mode==='align'&&!r.prompt.trim())fail("Provide the text to align");
    } else {
      if (!r.prompt.trim()) fail("A prompt is required");
      if (
        r.mode === "music" &&
        (!Number.isInteger(r.duration_seconds) || r.duration_seconds < 3 || r.duration_seconds > 300)
      )
        fail("Music duration must be 3–300 whole seconds");
      if (
        r.mode === "sound" &&
        (r.duration_seconds < 0.5 || r.duration_seconds > 30)
      )
        fail("Sound effects must be 0.5–30 seconds");
      if (r.mode === "music" && !r.instrumental && !r.lyrics.trim())
        fail("Provide lyrics for vocals");
      if (r.vocal_only && (r.mode !== "music" || r.instrumental))
        fail("Vocal-only generation requires vocal music");
    }
  });
export type AudioRequest = z.infer<typeof audioRequestSchema>;
export interface AudioRow {
  id: string;
  project_id: string;
  status: string;
  request: string;
  upstream_id: string | null;
  results: string;
  error: string | null;
  created_at: string;
}
export interface AudioResult {
  source?: z.infer<typeof sourceSchema>;
  analysis?: {
    duration: number;
    notes: {
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
    }[];
  };
  name?: string;
  source_id?: string;
  role?: string;
  transcript?: Transcript;
}
const slots = new Slots(2);
export const analysisReady = () => !!config.mediaModal.app;
export const audioReady = () => !!config.elevenlabsKey && analysisReady();
const readMedia = async (asset: AssetRow, signal: AbortSignal) =>
  readFile(await materializeAsset(asset, signal), { signal });
export async function audioCapabilities(): Promise<AudioCapability[]> {
  const singing=voiceCatalog();
  let remote: AudioCapability[]=[];
  remote=await elevenlabsCatalog();
  const processingReady=analysisReady();
  let storageReady=true;try{binaries()}catch{storageReady=false}
  remote=remote.map(m=>m.ready&&(!processingReady||(!storageReady&&!['recognize','align'].includes(m.category)))?{...m,ready:false,reason:!processingReady?'Configure the Modal media worker before processing audio':'Configure audio storage before generating audio'}:m);
  return [...remote,{id:'local:transcribe',name:'Audio to Notes',provider:'local',loop:false,category:'transcribe',ready:analysisReady(),reason:analysisReady()?undefined:'Configure the Modal media worker',voices:[],format:'wav',min_seconds:0,max_seconds:30,reference_audio:true},{id:'local:singing',name:'Score-driven singing',provider:'local',loop:false,category:'singing',ready:singing.some(v=>v.ready),reason:singing.some(v=>v.ready)?undefined:'Configure a Modal singing voice',voices:singing.filter(v=>v.ready).map(v=>v.id),format:'wav',min_seconds:0,max_seconds:0,reference_audio:false}];
}
export const publicJob = (j: AudioRow) => ({
  id: j.id,
  status: j.status,
  name: JSON.parse(j.request).name,
  mode: JSON.parse(j.request).mode,
  results: JSON.parse(j.results),
  error: j.error,
  can_resume: false,
  request: JSON.parse(j.request),
  applied: (JSON.parse(j.results) as {applied?:boolean}[]).some(r=>r.applied),
});
export async function ensureAudio(
  db: Store,
  projectId: string,
  input: unknown,
) {
  const project = getProject(db, projectId);
  const request = audioRequestSchema.parse(input);
  if (request.mode !== 'transcribe') {
    if(request.mode==='separate') invalid('Full music stem separation is unavailable. Use isolate only for speech cleanup.');
    if(request.provider==='openrouter') invalid('Batch audio now uses ElevenLabs. Select a current model.');
    if (!request.model) invalid('Select an ElevenLabs model before processing audio.');
    request.provider = 'elevenlabs';
  } else {
    request.provider='local';
    if(request.model&&request.model!=='local:transcribe')invalid('Choose the Audio to Notes model');
  }
  delete request.source_snapshot;
  delete request.reference_source_snapshot;
  request.reference_preparation='original';
  if(request.context) {
    const document=validateAudioContext(db,projectId,request.context);
    const clip=document.tracks.flatMap(t=>t.clips).find(c=>c.id===request.context?.clip_id);
    const selected=document.sources.find(s=>s.id===(clip?.source_id??request.context?.source_id??request.source_id));
    if(selected) request.source_snapshot=selected;
    else if(clip?.asset_id) request.source_snapshot=sourceSchema.parse({id:clip.asset_id,name:clip.name,kind:'audio',asset_id:clip.asset_id,duration:clip.offset+(clip.source_duration??clip.length_beats*60/document.tempo)});
    if(request.mode==='transcribe') {
      if(request.source_id&&clip?.source_id&&request.source_id!==clip.source_id)invalid('Analysis source differs from the selected Clip');
      const source=request.source_snapshot,offset=request.context.offset_seconds,length=request.context.duration_seconds??source?.duration??0;
      if(!source||source.kind!=='audio')invalid('Choose an audio Clip');
      if(length<=0||length>30||offset+length>source.duration+0.01)invalid('Choose an audio range of up to 30 seconds within the source');
    }
  }
  if (request.context) validateAudioContext(db, projectId, request.context);
  if (!project.is_draft) invalid('Open an editing draft before generating audio');
  if (request.provider==='elevenlabs') {
    if(!['recognize','align'].includes(request.mode))try{binaries()}catch{throw new ApiError(503,'audio_storage_unavailable','Configure audio storage before generating audio.');}
    const model=(await elevenlabsCatalog()).find(m=>m.id===request.model&&m.category===request.mode);
    if(!model)invalid('Selected ElevenLabs model is unavailable');
    try{validateElevenlabsRequest(request,model)}catch(error){invalid(error instanceof AudioProviderError?error.message:'Invalid audio request');}
    if(['voice_conversion','isolate','recognize','align'].includes(request.mode)) {
      const source=request.source_snapshot??documentSchema.parse(JSON.parse(project.document)).sources.find(s=>s.id===request.source_id);
      if(!source||source.kind!=='audio'||!source.asset_id)invalid('Choose an owned audio Clip');
      if(!db.get('SELECT id FROM assets WHERE id=? AND project_id=?',source.asset_id,projectId))invalid('Audio does not belong to this project');
      const offset=request.context?.offset_seconds??0,length=request.context?.duration_seconds??source.duration;
      if(length<=0||length>300||offset+length>source.duration+0.01)invalid('Choose an audio range within the source and at most 300 seconds');
      if(length<model.min_seconds)invalid(`This operation requires at least ${model.min_seconds} seconds of audio`);
      request.duration_seconds=length;
      request.source_snapshot=source;
    }
  }
  if(request.reference){
    if(request.mode!=='music')invalid('Audio reference conditioning is supported only for music');
    const ref=request.reference;
    const document=documentSchema.parse(JSON.parse(project.document));
    const generated=db.all<AudioRow>("SELECT * FROM audio_jobs WHERE project_id=? AND status='complete'",projectId).flatMap(j=>(JSON.parse(j.results) as AudioResult[]).flatMap(r=>r.source?[r.source]:[]));
    const source=document.sources.find(s=>s.id===ref.source_id)??generated.find(s=>s.id===ref.source_id);
    if(!source||source.kind!=='audio'||!source.asset_id)invalid('Choose an owned audio reference; render note Clips first');
    if(!db.get('SELECT id FROM assets WHERE id=? AND project_id=?',source.asset_id,projectId))invalid('Reference audio does not belong to this project');
    if(ref.offset_seconds+ref.duration_seconds>source.duration+0.01)invalid('Choose a reference excerpt within the source');
    request.reference_source_snapshot=source;
    request.reference_preparation=ref.duration_seconds<10?'repeat_to_minimum':'original';
  }
  if (!(request.provider==='elevenlabs' ? audioReady() : request.mode === "transcribe" && analysisReady()))
    throw new ApiError(503,'audio_unavailable','Audio provider or analysis dependencies are not configured.');
  const scope=request.provider==='elevenlabs'?`elevenlabs-v1:${request.model}`:'analysis-v2';
  const id=sha256Text(projectId+'\n'+scope+'\n'+pythonJSON(request));
  let existing=db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=?',id);
  if(existing)return existing;
  db.run(
    "INSERT INTO audio_jobs (id,project_id,status,request,upstream_id,results,error,created_at) VALUES (?,?,?, ?,NULL,?,NULL,?)",
    id,
    projectId,
    "submitting",
    JSON.stringify(request),
    "[]",
    now(),
  );
  existing = db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", id)!;
  await startAudio(id);
  return existing;
}
export async function startAudio(id: string) {
  const r = await runtime();
  if (r.audioTasks.has(id)) return;
  const controller = new AbortController();
  r.audioTasks.set(id, controller);
  void slots
    .run(controller.signal, () =>
      execute(
        r.store,
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(660000)]),
      ),
    )
    .catch(() => {
      r.store.run(
        "UPDATE audio_jobs SET status='interrupted',error=? WHERE id=? AND status!='complete'",
        "Stopped; submitted tasks are not resubmitted.",
        id,
      );
    })
    .finally(() => r.audioTasks.delete(id));
}
async function execute(db: Store, id: string, signal: AbortSignal) {
  try {
    const job = db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", id)!,
      request = audioRequestSchema.parse(JSON.parse(job.request)),
      document = documentSchema.parse(
        JSON.parse(getProject(db, job.project_id).document),
      );
    const completed = db.all<AudioRow>(
      "SELECT * FROM audio_jobs WHERE project_id=? AND status='complete'",
      job.project_id,
    );
    const previous = completed.flatMap((j) =>
      (JSON.parse(j.results) as AudioResult[]).map((r) => ({
        job: j,
        result: r,
      })),
    );
    const source =
      request.source_snapshot ?? document.sources.find((s) => s.id === request.source_id) ??
      previous.find((r) => r.result.source?.id === request.source_id)?.result
        .source;
    const asset = source?.asset_id
      ? db.get<AssetRow>(
          "SELECT * FROM assets WHERE id=? AND project_id=?",
          source.asset_id,
          job.project_id,
        )
      : undefined;
    let results: AudioResult[] = [];
    if(request.provider==='elevenlabs') {
      if(job.upstream_id) throw new Error('This ElevenLabs request cannot be resumed automatically');
      db.run("UPDATE audio_jobs SET status='processing' WHERE id=?",id);
      let input:Buffer|undefined;
      if(request.reference||['voice_conversion','isolate','recognize','align'].includes(request.mode)) {
        const selected=request.reference?request.reference_source_snapshot:source;
        const selectedAsset=request.reference?db.get<AssetRow>('SELECT * FROM assets WHERE id=? AND project_id=?',selected?.asset_id??'',job.project_id):asset;
        if(!selected||!selectedAsset)throw new AudioProviderError('Source audio is unavailable.');
        const offset=request.reference?.offset_seconds??request.context?.offset_seconds??0;
        const length=request.reference?.duration_seconds??request.context?.duration_seconds??selected.duration;
        const { audio: pcm } = await processModalAudio('excerpt', await readMedia(selectedAsset, signal), { offset, duration: length }, signal);
        if(request.reference&&length<10){
          if(!pcm.length)throw new AudioProviderError('Reference audio is empty.');
          const repeated=Buffer.alloc(10*44100*4);
          for(let offset=0;offset<repeated.length;offset+=pcm.length)pcm.copy(repeated,offset,0,Math.min(pcm.length,repeated.length-offset));
          input=pcmWave(repeated,44100,2);
        }else input=pcmWave(pcm,44100,2);
      }
      if(request.mode==='recognize'||request.mode==='align') {
        const transcript=request.mode==='recognize'?await transcribeElevenlabs(input!,signal):await alignElevenlabs(input!,request.prompt,signal);
        signal.throwIfAborted();db.run("UPDATE audio_jobs SET status='complete',results=?,error=NULL WHERE id=?",JSON.stringify([{transcript}]),id);return;
      }
      const bytes=await generateElevenlabs(request,signal,upstream=>db.run('UPDATE audio_jobs SET upstream_id=? WHERE id=?',upstream,id),input);
      const { audio: wav, duration } = await processModalAudio('normalize', bytes, {}, signal);
      if(!Number.isFinite(duration)||duration<=0||duration>300.1)throw new Error('Invalid generated audio duration');
      const assetId=sha256Text(`${job.id}:0`).slice(0,32);
      const prepared=await prepareAsset(job.project_id,`${request.name}.wav`,'audio/wav',wav,'sample',assetId,signal);
      const generated=sourceSchema.parse({id:assetId,name:request.name,kind:'audio',asset_id:assetId,duration});
      signal.throwIfAborted();
      db.tx(()=>{if(!db.get('SELECT id FROM assets WHERE id=?',assetId))publishAsset(db,prepared);db.run("UPDATE audio_jobs SET status='complete',results=?,error=NULL WHERE id=?",JSON.stringify([{source:generated}]),id);});
      return;
    } else if (request.mode === "transcribe") {
      const offset=request.context?.offset_seconds??0, length=request.context?.duration_seconds??source?.duration??0;
      if (!source || source.kind !== "audio" || !asset || length > 30 || offset+length>source.duration+0.01)
        invalid("Choose an audio source of at most 30 seconds");
      const analysis = await processModalAudio('transcribe', await readMedia(asset, signal), {
        offset, duration: length, mode: request.analysis_mode, min_pitch: request.min_pitch,
        max_pitch: request.max_pitch, drum_pitch: request.drum_pitch,
      }, signal);
      results = [
        {
          analysis,
          name: request.name,
          source_id: source.id,
        },
      ];
    } else {
      throw new AudioProviderError('This legacy audio job is no longer supported. Existing completed audio remains available.');
    }
    signal.throwIfAborted();
    db.run(
      "UPDATE audio_jobs SET status='complete',results=?,error=NULL WHERE id=?",
      JSON.stringify(results),
      id,
    );
  } catch(error) {
    db.run(
      "UPDATE audio_jobs SET status=?,error=? WHERE id=? AND status!=?",
      signal.aborted ? "interrupted" : "failed",
      error instanceof AudioProviderError ? error.message : "Audio processing stopped. Check the selected model and dependencies before starting a new request.",
      id,
      "complete",
    );
  }
}

export function validateAudioContext(db:Store,projectId:string,context:AudioContext) {
  const p=getProject(db,projectId);
  if(p.version!==context.expected_version)conflict(p.version);
  const d=documentSchema.parse(JSON.parse(p.document));
  const track=context.track_id?d.tracks.find(t=>t.id===context.track_id):undefined;
  if(context.track_id&&!track)invalid('Destination track no longer exists');
  if(context.clip_id&&track?.clips.find(c=>c.id===context.clip_id)?.locked)invalid('Target Clip is locked');
  if(track?.locked)invalid('Destination track is locked');
  if(context.clip_id&&!track?.clips.some(c=>c.id===context.clip_id))invalid('Target Clip no longer exists');
  const clip=track?.clips.find(c=>c.id===context.clip_id)
  const source=d.sources.find(s=>s.id===(context.source_id??clip?.source_id))
  if(context.source_id&&!source)invalid('Referenced source no longer exists')
  if(context.source_id&&clip?.source_id&&clip.source_id!==context.source_id)invalid('Referenced source differs from the selected Clip')
  if(context.note_ids?.some(id=>!source?.notes.some(n=>n.id===id)))invalid('Referenced notes no longer exist')
  return d;
}

export function audioProposal(db:Store,projectId:string,job:AudioRow,context:AudioContext):Command[] {
  const d=validateAudioContext(db,projectId,context);
  if(job.status!=='complete')invalid('Audio is not ready');
  const request=audioRequestSchema.parse(JSON.parse(job.request));
  if(request.reference_only)invalid('Reference renders are inputs, not final Clip proposals');
  const commands:unknown[]=[];
  const stableId=(role:string,index:number,note?:number)=>sha256Text(`${job.id}:${JSON.stringify(context)}:${role}:${index}:${note??''}`).slice(0,32);
  for(const [index,result] of (JSON.parse(job.results) as AudioResult[]).entries()) {
    if(result.transcript)invalid('Text results do not create audio Clips');
    const isNotes=!!result.analysis, beat=60/d.tempo;
    const source=result.source??sourceSchema.parse({id:stableId('source',index),name:result.name,kind:'notes',duration:result.analysis!.duration/beat,notes:result.analysis!.notes.map((n,j)=>({...n,id:stableId('note',index,j),start:n.start/beat,duration:n.duration/beat}))});
    if(source.asset_id&&!db.get('SELECT id FROM assets WHERE id=? AND project_id=?',source.asset_id,projectId))invalid('Generated media is unavailable');
    if(!d.sources.some(s=>s.id===source.id))commands.push({type:'source.add',source});
    if(!d.parts.some(p=>p.source_id===source.id))commands.push({type:'part.add',part:partSchema.parse({id:stableId('part',index),name:source.name,source_id:source.id,duration:source.duration})});
    const newTrack=isNotes||!context.track_id||!!context.clip_id;
    const track=newTrack?stableId('track',index):context.track_id!;
    if(newTrack&&!d.tracks.some(t=>t.id===track)){commands.push({type:'track.add',id:track,name:source.name,kind:isNotes?'instrument':'audio'});if(isNotes)commands.push({type:'track.update',track_id:track,muted:true});}
    if(!d.tracks.some(t=>t.clips.some(c=>c.id===stableId('clip',index))))commands.push({type:'clip.add',id:stableId('clip',index),track_id:track,name:source.name,kind:isNotes?'midi':'audio',source_id:source.id,start_beat:context.start_beat,length_beats:source.duration/(isNotes?1:beat),source_duration:source.duration});
  }
  if(request.mode==='transcribe'&&!request.source_id&&!request.context?.clip_id)invalid('Missing analysis source');
  return z.array(commandSchema).parse(commands);
}

export function acceptAudio(db:Store,projectId:string,job:AudioRow,context:AudioContext,requestId:string) {
  const latest=db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=? AND project_id=?',job.id,projectId);
  const document=documentSchema.parse(JSON.parse(getProject(db,projectId).document));
  const previous=latest?JSON.parse(latest.results) as (AudioResult&{applied?:boolean})[]:[];
  if(previous.length&&previous.every(r=>r.applied&&r.source&&document.tracks.some(t=>t.clips.some(c=>c.source_id===r.source!.id))))return {project:readProject(db,getProject(db,projectId))};
  const commands=audioProposal(db,projectId,latest??job,context);
  const result=applyCommands(db,projectId,{expected_version:context.expected_version,request_id:requestId,commands},true);
  const added=commands.filter(c=>c.type==='source.add').map(c=>c.source);
  db.run('UPDATE audio_jobs SET results=? WHERE id=?',JSON.stringify((JSON.parse((latest??job).results) as AudioResult[]).map((r,i)=>({...r,source:r.source??added[i],applied:true}))),job.id);
  return result;
}

export async function registerRenderedAudio(db:Store,projectId:string,input:{asset_id:string;name:string;context:AudioContext;reference_only?:boolean},signal:AbortSignal){
  if(!getProject(db,projectId).is_draft)invalid('Open an editing draft before rendering audio');
  const asset=db.get<AssetRow>('SELECT * FROM assets WHERE id=? AND project_id=?',input.asset_id,projectId);
  if(!asset)invalid('Rendered audio does not belong to this project');
  const { duration } = await processModalAudio('probe', await readMedia(asset, signal), {}, signal);
  const source=sourceSchema.parse({id:asset.id,name:input.name,kind:'audio',asset_id:asset.id,duration});
  const id=sha256Text(`render:${projectId}:${asset.id}`);
  db.run("INSERT OR IGNORE INTO audio_jobs VALUES (?,?, 'complete',?,NULL,?,NULL,?)",id,projectId,JSON.stringify({mode:'music',name:input.name,prompt:'Rendered Clip',context:input.context,reference_only:input.reference_only??false}),JSON.stringify([{source}]),now());
  return db.get<AudioRow>('SELECT * FROM audio_jobs WHERE id=?',id)!;
}
