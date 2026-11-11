/** Quiet local call feedback; never added to the song graph or exported audio. */
export function playVoiceCallTone(audio:AudioContext,kind:'connected'|'disconnected'){
  const duration=0.24,length=Math.ceil(audio.sampleRate*duration);
  const buffer=audio.createBuffer(1,length,audio.sampleRate),samples=new Float32Array(length);
  const frequencies=kind==='connected'?[523.25,783.99]:[659.25,440];
  for(let i=0;i<length;i++){
    const time=i/audio.sampleRate,index=time<0.09?0:1,local=time-index*0.1;
    if(local<0||local>=0.085)continue;
    const envelope=Math.min(1,local/0.008)*Math.pow(Math.max(0,1-local/0.085),2);
    samples[i]=Math.sin(2*Math.PI*frequencies[index]*local)*envelope*0.055;
  }
  buffer.copyToChannel(samples,0);
  const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);
  const ended=new Promise<void>(resolve=>{source.onended=()=>{source.disconnect();resolve()}});
  const at=audio.currentTime+0.01;source.start(at);
  return {ended,endTime:at+duration};
}
