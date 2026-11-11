import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RealtimeVoice} from './realtime-voice';
import {pcmBase64} from './realtime-pcm';
import {playVoiceCallTone} from './voice-call-tones';
vi.mock('./voice-call-tones',()=>({playVoiceCallTone:vi.fn(()=>({ended:Promise.resolve(),endTime:0}))}));

class Socket {
  static OPEN=1;static latest:Socket;
  readyState=1;bufferedAmount=0;sent:string[]=[];
  onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){Socket.latest=this}
  send(data:string){this.sent.push(data)}close=vi.fn();
  event(data:unknown){this.onmessage?.({data:JSON.stringify(data)})}
}
let stops:ReturnType<typeof vi.fn>[],mic:ReturnType<typeof vi.fn>,track:{stop:ReturnType<typeof vi.fn>;onended:unknown},voice:RealtimeVoice,errors:(error:Error)=>void;
let outputs:{onended:(()=>void)|null}[],capture:{onmessage:null|((event:{data:Float32Array})=>void)};
const node=()=>({connect:vi.fn(),disconnect:vi.fn()});
beforeEach(()=>{
  vi.mocked(playVoiceCallTone).mockClear();
  stops=[];outputs=[];track={stop:vi.fn(),onended:null};mic=vi.fn(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));errors=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:mic}});vi.stubGlobal('WebSocket',Socket);
  vi.stubGlobal('AudioContext',class{
    sampleRate=48000;currentTime=0;destination={};audioWorklet={addModule:vi.fn(async()=>{})};resume=async()=>{};close=vi.fn(async()=>{});
    createMediaStreamSource=node;createGain(){return {...node(),gain:{value:1}}}
    createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,copyToChannel:vi.fn()}}
    createBufferSource(){const stop=vi.fn();stops.push(stop);const output={...node(),stop,start:vi.fn(),buffer:null,onended:null};outputs.push(output);return output}
  });
  vi.stubGlobal('AudioWorkletNode',class{port={onmessage:null,close:vi.fn()};connect=vi.fn();disconnect=vi.fn();constructor(){capture=this.port}});
  voice=new RealtimeVoice({phase:vi.fn(),error:error=>errors(error),history:vi.fn(),project:vi.fn()});
});
afterEach(()=>{voice.close();vi.unstubAllGlobals()});
const start=()=>{voice.start('ws://test',{type:'demotif.context',version:1,context:null});Socket.latest.onopen?.()};
it('opens the microphone only after session acknowledgement and stops it on closure',async()=>{
  start();expect(mic).not.toHaveBeenCalled();Socket.latest.event({type:'demotif.ready',sample_rate:24000});await vi.waitFor(()=>expect(mic).toHaveBeenCalledTimes(1));
  await vi.waitFor(()=>expect(playVoiceCallTone).toHaveBeenCalledWith(expect.anything(),'connected'));
  voice.close();expect(track.stop).toHaveBeenCalledTimes(1);expect(Socket.latest.close).toHaveBeenCalled();
  voice.close();expect(vi.mocked(playVoiceCallTone).mock.calls.filter(([,kind])=>kind==='disconnected')).toHaveLength(1);
});
it('requests an opening only after the microphone and audio graph are ready',async()=>{
  let grant!:(stream:unknown)=>void;mic.mockImplementation(()=>new Promise(resolve=>{grant=resolve}));
  start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});
  expect(Socket.latest.sent.some(e=>JSON.parse(e).type==='demotif.start')).toBe(false);
  grant({getTracks:()=>[track],getAudioTracks:()=>[track]});
  await vi.waitFor(()=>expect(Socket.latest.sent.filter(e=>JSON.parse(e).type==='demotif.start')).toHaveLength(1));
  Socket.latest.event({type:'demotif.ready',sample_rate:24000});
  expect(Socket.latest.sent.filter(e=>JSON.parse(e).type==='demotif.start')).toHaveLength(1);
});
it('clears queued audio and ignores late chunks after interruption',async()=>{
  start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});await new Promise(resolve=>setTimeout(resolve,0));
  const audio=pcmBase64(new Uint8Array(960));
  Socket.latest.event({type:'response.created',response:{id:'old'}});Socket.latest.event({type:'response.audio.delta',response_id:'old',delta:audio});expect(stops).toHaveLength(1);
  Socket.latest.event({type:'input_audio_buffer.speech_started',item_id:'next'});expect(stops[0]).toHaveBeenCalledTimes(1);
  Socket.latest.event({type:'response.audio.delta',response_id:'old',delta:audio});expect(stops).toHaveLength(1);
  Socket.latest.event({type:'response.created',response:{id:'new'}});Socket.latest.event({type:'response.audio.delta',response_id:'new',delta:audio});expect(stops).toHaveLength(2);
});
it('releases a late microphone permission result after ending the session',async()=>{
  let grant!:(stream:unknown)=>void;mic.mockImplementation(()=>new Promise(resolve=>{grant=resolve}));
  start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});voice.close();grant({getTracks:()=>[track],getAudioTracks:()=>[track]});await new Promise(resolve=>setTimeout(resolve,0));expect(track.stop).toHaveBeenCalledTimes(1);
});
it('reports permission failures and disconnects once',async()=>{
  mic.mockRejectedValue(new Error('Permission denied'));start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});await vi.waitFor(()=>expect(errors).toHaveBeenCalledTimes(1));
  expect(Socket.latest.onmessage).toBeNull();expect(Socket.latest.onclose).toBeNull();
  expect(playVoiceCallTone).not.toHaveBeenCalled();
});
it('holds both microphone uplink and voice playback, resuming the same session without cues or another greeting',async()=>{
  start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});await vi.waitFor(()=>expect(capture?.onmessage).toBeTypeOf('function'));
  capture.onmessage!({data:new Float32Array(960)});
  const before=Socket.latest.sent.filter(e=>JSON.parse(e).type==='input_audio_buffer.append').length;expect(before).toBe(1);
  voice.hold(true);capture.onmessage!({data:new Float32Array(1920)});
  Socket.latest.event({type:'response.created',response:{id:'while-held'}});Socket.latest.event({type:'response.audio.delta',response_id:'while-held',delta:pcmBase64(new Uint8Array(960))});
  expect(stops).toHaveLength(0);expect(Socket.latest.sent.filter(e=>JSON.parse(e).type==='input_audio_buffer.append')).toHaveLength(before);
  voice.hold(false);capture.onmessage!({data:new Float32Array(960)});
  expect(Socket.latest.sent.filter(e=>JSON.parse(e).type==='input_audio_buffer.append')).toHaveLength(before+1);
  expect(Socket.latest.sent.filter(e=>JSON.parse(e).type==='demotif.start')).toHaveLength(1);expect(mic).toHaveBeenCalledTimes(1);
  expect(vi.mocked(playVoiceCallTone).mock.calls.map(([,kind])=>kind)).toEqual(['connected']);
});
it('waits for response completion and the final locally queued sample, including stream gaps',async()=>{
  const drained=vi.fn(),interrupted=vi.fn();voice=new RealtimeVoice({phase:vi.fn(),error:vi.fn(),history:vi.fn(),project:vi.fn(),drained,interrupted});
  start();Socket.latest.event({type:'demotif.ready',sample_rate:24000});await new Promise(resolve=>setTimeout(resolve,0));
  Socket.latest.event({type:'demotif.project',run_id:'prepare'});Socket.latest.event({type:'response.created',response:{id:'cue'}});
  const delta={type:'response.audio.delta',response_id:'cue',delta:pcmBase64(new Uint8Array(960))};Socket.latest.event(delta);
  outputs[0].onended!();expect(drained).not.toHaveBeenCalled();Socket.latest.event(delta);
  Socket.latest.event({type:'response.done',response:{id:'cue',status:'completed'}});expect(drained).not.toHaveBeenCalled();
  outputs[1].onended!();expect(drained).toHaveBeenCalledExactlyOnceWith('prepare');
  Socket.latest.event({type:'demotif.project',run_id:'cancelled'});Socket.latest.event({type:'response.created',response:{id:'cancelled-response'}});
  Socket.latest.event({type:'input_audio_buffer.speech_started'});Socket.latest.event({type:'response.done',response:{id:'cancelled-response',status:'completed'}});
  expect(drained).toHaveBeenCalledTimes(1);expect(interrupted).toHaveBeenCalledTimes(1);
});
