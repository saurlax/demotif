import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AudioEngine} from './audio';
import type {Project} from './model';
import {useStudioStore} from '@/stores/studio';

vi.mock('./mixGraph',()=>({createMixGraph:()=>({dispose:()=>{},track:()=>({})})}));
vi.mock('./audioRenderer',()=>({AudioRenderer:class{reset(){}async run(){return {wav:new Uint8Array(44)}}}}));
const project:Project={name:'Metronome',bpm:120,tracks:[],assets:[],parts:[]};
function clock(){
  const clicks:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
  const context={currentTime:0,sampleRate:48000,destination:{},resume:async()=>{},createOscillator:()=>{
    const source={frequency:{value:0},start:vi.fn(),stop:vi.fn(),connect:()=>{},disconnect:()=>{},onended:null};clicks.push(source);return source;
  },createGain:()=>({gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{}})};
  return {context,clicks};
}
let engine:AudioEngine;
beforeEach(()=>{vi.useFakeTimers();engine=new AudioEngine()});
afterEach(()=>{engine.release();useStudioStore.getState().stop();vi.useRealTimers();vi.unstubAllGlobals()});

it('uses the song start clock for clicks after preparation and seeking',async()=>{
  const {context,clicks}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  engine.configureMetronome(true,120,'4/4');const practice=clicks[0];context.currentTime=10;
  await engine.play(project,1.25);expect(practice.stop).toHaveBeenLastCalledWith();
  context.currentTime=10.45;vi.advanceTimersByTime(25);
  expect(clicks.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(10.52);
  engine.stop();expect(vi.getTimerCount()).toBe(0);
});
it('waits for the existing practice pulse when starting song playback',async()=>{
  const {context,clicks}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  engine.configureMetronome(true,120,'4/4');context.currentTime=0.1;
  await engine.play(project,0);
  context.currentTime=0.3;expect(engine.position()).toBe(0);
  context.currentTime=0.47;vi.advanceTimersByTime(25);
  expect(clicks.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(0.52);
  context.currentTime=0.62;expect(engine.position()).toBeCloseTo(0.1);
});
it('joins the next song pulse when metronome is enabled during playback',async()=>{
  const {context,clicks}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  await engine.play(project,0);context.currentTime=0.35;
  engine.configureMetronome(true,120,'4/4');expect(clicks).toHaveLength(0);
  context.currentTime=0.56;vi.advanceTimersByTime(25);
  expect(clicks).toHaveLength(1);expect(clicks[0].start.mock.calls[0][0]).toBeCloseTo(0.65);
});
it('disables old clicks while playback continues and cancels them on project release',async()=>{
  const {context,clicks}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  await engine.play(project,0);engine.configureMetronome(true,120,'4/4');context.currentTime=0.05;vi.advanceTimersByTime(25);
  const playing=clicks.at(-1)!;engine.configureMetronome(false,120,'4/4');expect(playing.stop).toHaveBeenLastCalledWith();expect(vi.getTimerCount()).toBe(0);
  engine.configureMetronome(true,90,'3/4');engine.release();expect(vi.getTimerCount()).toBe(0);
  useStudioStore.getState().setMetronome(true);useStudioStore.getState().stop();expect(useStudioStore.getState().metronome).toBe(false);
});
it('never creates metronome clicks in OfflineAudioContext during WAV export',async()=>{
  const {context}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  const offlineOscillator=vi.fn();
  vi.stubGlobal('OfflineAudioContext',class{
    destination={};createOscillator=offlineOscillator;
    async startRendering(){return {numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(44100)}}
  });
  engine.configureMetronome(true,120,'4/4');
  const wav=await engine.export(project,1);expect(wav.type).toBe('audio/wav');expect(offlineOscillator).not.toHaveBeenCalled();
});
it('prepares without starting and accepts the recorder-selected audio onset',async()=>{
  const {context}=clock();vi.stubGlobal('AudioContext',class{constructor(){return context}});
  const prepared=await engine.preparePlayback(project,2);expect(prepared).toBeDefined();expect(engine.position()).toBe(2);
  expect(prepared!.start(4)).toBe(true);context.currentTime=4.5;expect(engine.position()).toBe(2.5);
  engine.stop();expect(prepared!.start(5)).toBe(false);
});
it('schedules a final output gate on the audio clock so effect tails cannot outlast bounded capture',async()=>{
  const {context}=clock(),set=vi.fn(),ramp=vi.fn();
  context.createGain=()=>({gain:{setValueAtTime:set,linearRampToValueAtTime:ramp,exponentialRampToValueAtTime:vi.fn()},connect:()=>{},disconnect:()=>{}});
  vi.stubGlobal('AudioContext',class{constructor(){return context}});
  const prepared=await engine.preparePlayback(project,0);prepared!.start(4,false,1.5);
  expect(set).toHaveBeenCalledWith(0,0);expect(set).toHaveBeenCalledWith(1,4);expect(ramp).toHaveBeenCalledWith(0,5.5);
});
