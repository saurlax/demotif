import {realtimeProviderEvent,realtimeSampleRate,type RealtimeClientEvent} from '../shared/realtime';
import {decodePCM,pcmBase64,RealtimePCMEncoder,RealtimeResponseGate} from './realtime-pcm';
import {playVoiceCallTone} from './voice-call-tones';

export type RealtimeVoicePhase='idle'|'requesting'|'listening'|'thinking'|'speaking';
type Callbacks={phase:(phase:RealtimeVoicePhase)=>void;error:(error:Error)=>void;history:()=>void;project:()=>void;drained?:(run:string)=>void;interrupted?:()=>void};
export class RealtimeVoice {
  private socket?:WebSocket;
  private audio?:AudioContext;
  private stream?:MediaStream;
  private capture?:AudioWorkletNode;
  private source?:MediaStreamAudioSourceNode;
  private mute?:GainNode;
  private sources=new Set<AudioBufferSourceNode>();
  private gate=new RealtimeResponseGate();
  private cursor=0;
  private cueUntil=0;
  private closed=true;
  private ready=false;
  private held=false;
  private encoder?:RealtimePCMEncoder;
  private pendingRun?:string;
  private replyRun?:string;
  private replyResponse?:string;
  private replyDone=false;
  private inputOpening=false;
  private setupTimer?:ReturnType<typeof setTimeout>;
  private speaking=false;
  private phase:RealtimeVoicePhase='idle';
  constructor(private callbacks:Callbacks){}
  private state(phase:RealtimeVoicePhase){if(this.closed&&phase!=='idle')return;this.phase=phase;this.callbacks.phase(phase)}
  private fail(error:unknown){if(this.closed)return;this.close();this.callbacks.error(error instanceof Error?error:new Error('Realtime voice stopped.'))}
  private send(event:RealtimeClientEvent){
    if(this.closed||this.socket?.readyState!==WebSocket.OPEN)return;
    if(this.socket.bufferedAmount>realtimeSampleRate*2*10*4/3)throw new Error('Voice connection is falling behind. Reconnect to continue.');
    this.socket.send(JSON.stringify(event));
  }
  start(url:string,context:Extract<RealtimeClientEvent,{type:'demotif.context'}>){
    if(!this.closed)return;
    this.closed=false;this.state('requesting');
    try{
      // Created synchronously from the user's gesture, before waiting for a network response.
      this.audio=new AudioContext();void this.audio.resume().catch(e=>this.fail(e));
      this.socket=new WebSocket(url);
      this.setupTimer=setTimeout(()=>this.fail(new Error('Realtime voice connection timed out.')),15000);
      this.socket.onopen=()=>{try{this.send(context)}catch(e){this.fail(e)}};
      this.socket.onmessage=e=>{try{this.receive(JSON.parse(e.data))}catch(error){this.fail(error)}};
      this.socket.onerror=()=>this.fail(new Error('Cannot connect realtime voice. Check StepFun configuration.'));
      this.socket.onclose=()=>{if(!this.closed)this.fail(new Error('Realtime voice disconnected. Start voice again to reconnect.'))};
    }catch(error){this.fail(error)}
  }
  update(context:Extract<RealtimeClientEvent,{type:'demotif.context'}>){try{this.send(context)}catch(e){this.fail(e)}}
  private receive(value:unknown){
    if(this.closed)return;
    const event=realtimeProviderEvent.parse(value);
    if(event.type==='demotif.ready'){
      if(event.sample_rate!==realtimeSampleRate)throw new Error('Unsupported realtime sample rate.');
      if(!this.ready&&!this.inputOpening){this.inputOpening=true;void this.openInput().catch(e=>this.fail(e));}return;
    }
    if(event.type==='demotif.error')throw new Error(typeof event.message==='string'?event.message:'Realtime voice failed.');
    if(event.type==='demotif.history'||event.type==='demotif.run')this.callbacks.history();
    if(event.type==='demotif.project'){this.pendingRun=typeof event.run_id==='string'?event.run_id:undefined;this.callbacks.project();this.callbacks.history();}
    if(event.type==='response.created'&&event.response){
      this.gate.begin(event.response.id);this.state('thinking');
      if(this.pendingRun){this.replyRun=this.pendingRun;this.pendingRun=undefined;this.replyResponse=event.response.id;this.replyDone=false;}
    }
    if(event.type==='input_audio_buffer.speech_started'||event.type==='demotif.interrupted'){
      this.pendingRun=undefined;this.replyRun=undefined;this.callbacks.interrupted?.();this.stopPlayback();this.state('listening');
    }
    if(event.type==='input_audio_buffer.speech_stopped')this.state('thinking');
    if(event.type==='demotif.listening')this.state('listening');
    if(event.type==='response.audio.delta'&&event.response_id&&this.gate.accepts(event.response_id))this.play(event.delta??'');
    if(event.type==='response.done'){
      if(event.response&&event.response.id===this.replyResponse){this.replyDone=event.response.status==='completed';if(!this.replyDone){this.replyRun=undefined;this.callbacks.interrupted?.();}}
      this.drainReply();if(!this.sources.size)this.state('listening');
    }
  }
  private async openInput(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone recording is unavailable in this browser.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(this.closed){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    for(const track of stream.getAudioTracks())track.onended=()=>this.fail(new Error('Microphone disconnected.'));
    const audio=this.audio!;
    await audio.audioWorklet.addModule('/realtime-capture.js');
    if(this.closed)return;
    const encoder=new RealtimePCMEncoder(audio.sampleRate);this.encoder=encoder;
    this.capture=new AudioWorkletNode(audio,'demotif-realtime-capture');
    this.capture.port.onmessage=e=>{
      if(this.closed||!this.ready||this.held||audio.currentTime<this.cueUntil)return;
      try{for(const chunk of encoder.push(e.data as Float32Array))this.send({type:'input_audio_buffer.append',audio:pcmBase64(chunk)})}catch(error){this.fail(error)}
    };
    this.source=audio.createMediaStreamSource(stream);this.mute=audio.createGain();this.mute.gain.value=0;
    this.source.connect(this.capture);this.capture.connect(this.mute);this.mute.connect(audio.destination);
    this.ready=true;clearTimeout(this.setupTimer);this.state('listening');
    if(this.held){this.send({type:'demotif.hold',active:true});return;}
    try{
      const cue=playVoiceCallTone(audio,'connected');
      this.cursor=cue.endTime;this.cueUntil=cue.endTime;
    }catch{/* Feedback must not prevent voice conversation. */}
    // Ask for the opening only after microphone permission and audio setup succeed.
    this.send({type:'demotif.start'});
  }
  private play(base64:string){
    if(this.held)return;
    const samples=decodePCM(base64);if(!samples.length)return;
    const audio=this.audio!;
    if(this.cursor-audio.currentTime>10)throw new Error('Voice playback is falling behind. Reconnect to continue.');
    const buffer=audio.createBuffer(1,samples.length,realtimeSampleRate);buffer.copyToChannel(samples,0);
    const node=audio.createBufferSource();node.buffer=buffer;node.connect(audio.destination);this.sources.add(node);
    const at=Math.max(audio.currentTime+0.02,this.cursor);this.cursor=at+buffer.duration;this.speaking=true;
    node.onended=()=>{node.disconnect();this.sources.delete(node);if(!this.sources.size&&this.speaking){this.speaking=false;this.state('listening')}this.drainReply()};
    node.start(at);this.state('speaking');
  }
  private stopPlayback(){
    this.gate.interrupt();this.speaking=false;
    for(const node of this.sources){node.onended=null;try{node.stop()}catch{}node.disconnect()}
    this.sources.clear();this.cursor=0;
  }
  private drainReply(){
    if(!this.replyRun||!this.replyDone||this.sources.size)return;
    const run=this.replyRun;this.replyRun=undefined;this.replyResponse=undefined;this.callbacks.drained?.(run);
  }
  interrupt(){if(this.closed)return;try{this.stopPlayback();this.send({type:'demotif.interrupt'});this.state('listening')}catch(e){this.fail(e)}}
  hold(active:boolean){
    if(this.held===active)return;
    this.held=active;
    this.encoder?.reset();
    if(this.closed||!this.ready)return;
    try{if(active)this.stopPlayback();this.send({type:'demotif.hold',active});this.state('listening')}catch(e){this.fail(e)}
  }
  finish(){if(this.closed||!this.ready||this.phase!=='listening')return;try{this.send({type:'demotif.finish'});this.state('thinking')}catch(e){this.fail(e)}}
  recordingResult(run:string,request:string){
    if(this.closed||!this.ready)return false;
    try{this.send({type:'demotif.recording_result',run_id:run,request_id:request});return true}catch(e){this.fail(e);return false}
  }
  close(){
    this.callbacks.interrupted?.();
    if(this.closed)return;const connected=this.ready;this.closed=true;this.ready=false;clearTimeout(this.setupTimer);this.stopPlayback();
    if(this.capture){this.capture.port.onmessage=null;this.capture.port.close();this.capture.disconnect();this.capture=undefined;}
    this.source?.disconnect();this.mute?.disconnect();
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop()});this.stream=undefined;
    if(this.audio){
      const audio=this.audio;this.audio=undefined;
      if(connected){try{void playVoiceCallTone(audio,'disconnected').ended.finally(()=>audio.close()).catch(()=>{});}catch{void audio.close().catch(()=>{});}}
      else void audio.close().catch(()=>{});
    }
    if(this.socket){this.socket.onopen=null;this.socket.onmessage=null;this.socket.onerror=null;this.socket.onclose=null;this.socket.close();this.socket=undefined;}
    this.state('idle');
  }
}
