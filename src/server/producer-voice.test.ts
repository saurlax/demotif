import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {config} from './config';
import {speakReply,transcribeVoice} from './producer-voice';
import {pcmWave} from './audio-providers/pcm';
vi.mock('./audio-providers/modal-media',()=>({
  processModalAudio: async (operation: string, input: Buffer) => {
    expect(operation).toBe('voice_wav');
    expect(input.readUInt32LE(24)).toBe(24000);
    return { audio: pcmWave(Buffer.alloc(6400),16000,1) };
  },
}));
let original:string;
beforeEach(()=>{original=config.elevenlabsKey;config.elevenlabsKey='voice-test-'+crypto.randomUUID();});
afterEach(()=>{config.elevenlabsKey=original;vi.unstubAllGlobals();});
it('normalizes synthetic microphone audio and uses direct multipart STT, without S3',async()=>{
  const send=vi.fn(async(url:string,init?:RequestInit)=>{
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    const body=init!.body as FormData;expect(body.get('model_id')).toBe('scribe_v2');
    const audio=Buffer.from(await (body.get('file') as Blob).arrayBuffer());
    expect(audio.readUInt32LE(24)).toBe(16000);
    return Response.json({text:'  测试语音  ',words:[]});
  });vi.stubGlobal('fetch',send);
  expect(await transcribeVoice(pcmWave(Buffer.alloc(9600),24000,1),new AbortController().signal)).toBe('测试语音');
  expect(send).toHaveBeenCalledTimes(1);
});
it('uses direct TTS and strips markdown from a spoken reply',async()=>{
  const send=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/v1/models'))return Response.json([{model_id:'eleven_v4_turbo',name:'Voice',can_do_text_to_speech:true}]);
    if(url.includes('/v2/voices'))return Response.json({voices:[{voice_id:'voice',name:'Voice'}]});
    expect(url).toContain('https://api.elevenlabs.io/v1/text-to-speech/voice');
    expect(JSON.parse(String(init?.body))).toEqual({text:'Hello world',model_id:'eleven_v4_turbo'});
    return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});
  });vi.stubGlobal('fetch',send);
  expect([...await speakReply('**Hello** [world](https://example.com)',new AbortController().signal)]).toEqual([1,2,3]);
});
it('rejects empty recordings before any network call',async()=>{
  const send=vi.fn();vi.stubGlobal('fetch',send);
  await expect(transcribeVoice(new Uint8Array(),new AbortController().signal)).rejects.toThrow('No microphone');expect(send).not.toHaveBeenCalled();
});
