export function metronomePulse(tempo:number,meter:string){
  const [beats,denominator]=meter.split('/').map(Number);
  if(!Number.isFinite(tempo)||tempo<=0||!Number.isInteger(beats)||beats<=0||!Number.isInteger(denominator)||denominator<=0)throw new Error('Invalid metronome tempo or time signature.');
  return {seconds:60/tempo*4/denominator,beats};
}

/** A short lookahead queues Web Audio events; timers never determine click onset. */
export class Metronome {
  private timer?:ReturnType<typeof setInterval>;
  private pending=new Set<{oscillator:OscillatorNode;gain:GainNode}>();
  private pulse=0;
  private origin=0;
  private seconds=0.5;
  private beats=4;
  private until=Infinity;
  constructor(private context:AudioContext){}

  alignedStart(from:number,earliest:number){
    if(this.timer===undefined)return undefined;
    const phase=((from%this.seconds)+this.seconds)%this.seconds;
    const pulse=Math.ceil((earliest+phase-this.origin)/this.seconds-1e-8);
    return this.origin+pulse*this.seconds-phase;
  }
  start(tempo:number,meter:string,anchor:{from:number;when:number;continueBeforeStart?:boolean;until?:number}={from:0,when:this.context.currentTime+0.02}){
    this.stop();
    const timing=metronomePulse(tempo,meter);this.seconds=timing.seconds;this.beats=timing.beats;
    this.origin=anchor.when-anchor.from;
    this.until=anchor.until??Infinity;
    const earliest=anchor.continueBeforeStart?this.context.currentTime+0.005:Math.max(anchor.when,this.context.currentTime+0.005);
    this.pulse=Math.ceil((earliest-this.origin)/this.seconds-1e-8);
    this.schedule();this.timer=setInterval(()=>this.schedule(),25);
  }
  private schedule(){
    const now=this.context.currentTime;
    // Skip missed beats after a throttled callback rather than play a burst of old clicks.
    this.pulse=Math.max(this.pulse,Math.ceil((now+0.005-this.origin)/this.seconds-1e-8));
    while(this.origin+this.pulse*this.seconds<Math.min(now+0.12,this.until)){
      const time=this.origin+this.pulse*this.seconds,accent=this.pulse%this.beats===0;
      const oscillator=this.context.createOscillator(),gain=this.context.createGain();
      oscillator.frequency.value=accent?1400:1000;
      gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(accent?0.14:0.09,time+0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001,time+0.035);
      oscillator.connect(gain);gain.connect(this.context.destination);
      const click={oscillator,gain};this.pending.add(click);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.pending.delete(click)};
      oscillator.start(time);oscillator.stop(time+0.04);this.pulse++;
    }
  }
  stop(){
    clearInterval(this.timer);this.timer=undefined;
    for(const {oscillator,gain} of this.pending){oscillator.onended=null;try{oscillator.stop()}catch{/* Already ended. */}oscillator.disconnect();gain.disconnect();}
    this.pending.clear();
  }
}
