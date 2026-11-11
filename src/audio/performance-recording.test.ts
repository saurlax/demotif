import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PerformanceRecording} from './performance-recording';
import type {AudioEngine} from './audio';
import type {RecorderEvents} from './vocal-recorder';
import type {Project} from './model';
const capture=vi.hoisted(()=>({events:undefined as RecorderEvents|undefined,prepare:vi.fn(),recordAt:vi.fn(),stop:vi.fn(),dispose:vi.fn()}));
vi.mock('./vocal-recorder',()=>({VocalRecorder:class{
  constructor(events:RecorderEvents){capture.events=events}
  prepare=capture.prepare;recordAt=capture.recordAt;stop=capture.stop;dispose=capture.dispose;
}}));
const project:Project={name:'Counted performance',bpm:120,tracks:[],assets:[],parts:[]};
beforeEach(()=>vi.resetAllMocks());afterEach(()=>vi.unstubAllGlobals());
function fixture(){
  const clicks:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
  const context={currentTime:2,sampleRate:48000,createOscillator(){const oscillator={frequency:{value:0},connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};clicks.push(oscillator);return oscillator},createGain:()=>({gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()})};
  const start=vi.fn((_when:number)=>true),engine={preparePlayback:vi.fn(async(_project:Project,_from:number)=>({context,start})),stop:vi.fn(),stopMetronome:vi.fn()};
  const events={phase:vi.fn(),progress:vi.fn(),level:vi.fn(),take:vi.fn(),error:vi.fn()};
  capture.prepare.mockImplementation(async()=>{capture.events!.phase('ready');return true});
  const controller=new PerformanceRecording(engine as unknown as AudioEngine,events);
  return {controller,engine,events,context,start,clicks};
}
it('waits for readiness and starts accompaniment and capture at one sample-aligned onset after four clicks',async()=>{
  const h=fixture();expect(()=>h.controller.start(120,'6/8','four')).toThrow('Prepare');
  await h.controller.prepare(project,4,'input');
  expect(capture.prepare).toHaveBeenCalledWith('input',h.context);expect(h.start).not.toHaveBeenCalled();
  h.controller.start(120,'6/8','four');
  const onset=h.start.mock.calls[0][0];expect(onset).toBeCloseTo(4.1);
  expect(capture.recordAt).toHaveBeenCalledWith(onset);expect(h.clicks.map(click=>click.start.mock.calls[0][0])).toEqual([onset-2,onset-1.5,onset-1,onset-.5]);
  capture.events!.phase('count-in');h.controller.stop();expect(capture.stop).toHaveBeenCalledWith(true);expect(h.clicks.every(click=>click.stop.mock.calls.length===2)).toBe(true);
});
it('arms a finite dry capture and excludes accompaniment without requiring a stop click',async()=>{
  const h=fixture();await h.controller.prepare(project,2,undefined,false,1.5);h.controller.start(120,'4/4','none',1.5);
  expect(h.engine.preparePlayback.mock.calls[0][0]).toMatchObject({tracks:[],assets:[]});
  expect(h.engine.stopMetronome).toHaveBeenCalledOnce();expect(capture.recordAt).toHaveBeenCalledWith(h.start.mock.calls[0][0],1.5);
  capture.events!.phase('idle');expect(h.engine.stop).toHaveBeenCalled();
});
it('cancels delayed preparation and never arms a late-ready microphone',async()=>{
  const h=fixture();let ready!:(value:boolean)=>void;
  capture.prepare.mockImplementation(()=>new Promise<boolean>(resolve=>{ready=resolve}));
  const pending=h.controller.prepare(project,0);await Promise.resolve();h.controller.dispose();ready(true);
  expect(await pending).toBe(false);expect(capture.recordAt).not.toHaveBeenCalled();expect(h.start).not.toHaveBeenCalled();
});
