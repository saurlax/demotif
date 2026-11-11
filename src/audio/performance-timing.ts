import {metronomePulse} from './metronome';
export type CountIn='none'|'four'|'bar';
export function performanceTiming(tempo:number,meter:string,countIn:CountIn,earliest:number,sampleRate:number){
  const pulse=metronomePulse(tempo,meter);
  const count=countIn==='none'?0:countIn==='four'?4:pulse.beats;
  const interval=countIn==='four'?60/tempo:pulse.seconds;
  const onset=Math.ceil((earliest+count*interval)*sampleRate)/sampleRate;
  return {onset,clicks:Array.from({length:count},(_,i)=>({time:onset-(count-i)*interval,accent:i===0}))};
}
export function scheduleCountIn(context:AudioContext,clicks:{time:number;accent:boolean}[]){
  const nodes=clicks.map(({time,accent})=>{
    const oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.frequency.value=accent?1400:1000;gain.gain.setValueAtTime(0.12,time);gain.gain.exponentialRampToValueAtTime(0.0001,time+0.035);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
    oscillator.start(time);oscillator.stop(time+0.04);return{oscillator,gain};
  });
  return ()=>{for(const {oscillator,gain} of nodes){oscillator.onended=null;try{oscillator.stop()}catch{}oscillator.disconnect();gain.disconnect()}};
}
