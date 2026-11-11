import {AudioEngine} from './audio';
import type {Project} from './model';
import {VocalRecorder,type RecorderEvents,type RecordingPhase} from './vocal-recorder';
import {performanceTiming,scheduleCountIn,type CountIn} from './performance-timing';

export class PerformanceRecording {
  private recorder:VocalRecorder;
  private generation=0;
  private prepared?:Awaited<ReturnType<AudioEngine['preparePlayback']>>;
  private cancelClicks?:()=>void;
  private phase:RecordingPhase='idle';
  private accompaniment=true;
  private engine:AudioEngine;
  private events:RecorderEvents;
  constructor(engine:AudioEngine,events:RecorderEvents){
    this.engine=engine;this.events=events;
    this.recorder=new VocalRecorder({...events,phase:phase=>{
      if(phase==='idle')this.finish();else{this.phase=phase;events.phase(phase)}
    },take:take=>events.take(take)});
  }
  private finish(){this.cancelClicks?.();this.cancelClicks=undefined;this.engine.stop();this.phase='idle';this.events.phase('idle')}
  async prepare(project:Project,from:number,device?:string,accompaniment=true,duration?:number){
    this.dispose();const generation=++this.generation;this.phase='preparing';this.events.phase('preparing');
    this.accompaniment=accompaniment;
    const end=duration===undefined?Infinity:from+duration;
    const bounded=duration===undefined?project:{...project,tracks:project.tracks.map(track=>({...track,clips:track.clips.filter(clip=>clip.start<end).map(clip=>({...clip,duration:Math.min(clip.duration,end-clip.start)}))}))};
    const prepared=await this.engine.preparePlayback(accompaniment?bounded:{...project,tracks:[],assets:[]},from);
    if(generation!==this.generation)return false;
    if(!prepared)throw new Error('Playback preparation was cancelled.');
    this.prepared=prepared;
    const ready=await this.recorder.prepare(device,prepared.context);
    return !!ready&&generation===this.generation;
  }
  start(tempo:number,meter:string,countIn:CountIn,duration?:number){
    const prepared=this.prepared;
    if(!prepared||this.phase!=='ready')throw new Error('Prepare your microphone before recording.');
    const plan=performanceTiming(tempo,meter,countIn,prepared.context.currentTime+0.1,prepared.context.sampleRate);
    const started=duration===undefined?prepared.start(plan.onset):prepared.start(plan.onset,false,duration);
    if(!started)throw new Error('The project changed. Prepare recording again.');
    if(!this.accompaniment)this.engine.stopMetronome();
    this.cancelClicks=scheduleCountIn(prepared.context,plan.clicks);
    if(duration===undefined)this.recorder.recordAt(plan.onset);else this.recorder.recordAt(plan.onset,duration);
  }
  stop(interrupted=false){
    if(this.phase==='preparing'||this.phase==='ready'){this.dispose();return}
    if(this.phase==='count-in'||this.phase==='recording'){
      this.cancelClicks?.();this.cancelClicks=undefined;this.engine.stop();
      this.recorder.stop(interrupted||this.phase==='count-in');
    }
  }
  dispose(){const active=this.phase!=='idle';this.generation++;this.recorder.dispose();this.prepared=undefined;this.cancelClicks?.();this.cancelClicks=undefined;if(active)this.finish()}
}
