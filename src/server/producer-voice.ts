import {config} from './config';
import {ApiError} from './errors';
import {audioRequestSchema} from './audio-jobs';
import {processModalAudio} from './audio-providers/modal-media';
import {elevenlabsCatalog,generateElevenlabs,transcribeElevenlabs,AudioProviderError} from './audio-providers/elevenlabs';

export const voiceModels={transcription:'scribe_v2',speech:'eleven_v4_turbo'} as const;
const unavailable=(error?:unknown)=>new ApiError(502,'voice_unavailable',error instanceof AudioProviderError?error.message:'Voice service is unavailable. Try text instead.');
export async function transcribeVoice(bytes:Uint8Array,signal:AbortSignal):Promise<string>{
  if(!config.elevenlabsKey)throw new ApiError(503,'voice_unavailable','Configure ElevenLabs before using voice.');
  if(!bytes.length)throw new ApiError(422,'invalid_voice','No microphone audio was captured.');
  try{
    const { audio: wav } = await processModalAudio('voice_wav', bytes, {}, signal);
    return (await transcribeElevenlabs(wav,signal)).text.trim();
  }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof ApiError)throw error;throw unavailable(error);}
}
export async function speakReply(text:string,signal:AbortSignal):Promise<Buffer>{
  try{
    const models=(await elevenlabsCatalog()).filter(m=>m.category==='speech'&&m.ready);
    const model=models.find(m=>m.id===voiceModels.speech)??models.find(m=>m.id==='eleven_multilingual_v2');
    if(!model)throw unavailable();
    const spoken=text.replace(/```[\s\S]*?```/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*#`]/g,'').trim();
    if(!spoken)throw new ApiError(409,'speech_unavailable','This reply has no speakable text.');
    return await generateElevenlabs(audioRequestSchema.parse({model:model.id,mode:'speech',prompt:spoken,voice:model.voices[0]}),signal,()=>{});
  }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof ApiError)throw error;throw unavailable(error);}
}
