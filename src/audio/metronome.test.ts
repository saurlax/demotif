import {afterEach,expect,it,vi} from 'vitest';
import {Metronome,metronomePulse} from './metronome';

type Click={frequency:{value:number};start:ReturnType<typeof vi.fn<(at:number)=>void>>;stop:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;onended:(()=>void)|null};
function clock(){
  const clicks:Click[]=[],gains:ReturnType<typeof vi.fn>[]=[];
  const context={currentTime:0,destination:{},createOscillator:()=>{
    const click={frequency:{value:0},start:vi.fn<(at:number)=>void>(),stop:vi.fn(),connect:vi.fn(),disconnect:vi.fn(),onended:null};clicks.push(click);return click;
  },createGain:()=>{const disconnect=vi.fn();gains.push(disconnect);return {gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect}}};
  const metro=new Metronome(context as unknown as AudioContext);
  const advance=(time:number)=>{context.currentTime=time;vi.advanceTimersByTime(25)};
  return {context,clicks,gains,metro,advance};
}
afterEach(()=>vi.useRealTimers());
it.each([['4/4',0.5,4],['3/4',0.5,3],['6/8',0.25,6]])('follows %s pulse spacing and bar accents',(meter,seconds,beats)=>{
  vi.useFakeTimers();const {metro,advance,clicks}=clock();
  expect(metronomePulse(120,meter as string)).toEqual({seconds,beats});metro.start(120,meter as string);
  for(let i=1;i<=Number(beats);i++)advance(0.02+i*Number(seconds)-0.05);
  expect(clicks).toHaveLength(Number(beats)+1);
  clicks.forEach((click,i)=>{expect(click.start).toHaveBeenCalledWith(0.02+i*Number(seconds));expect(click.frequency.value).toBe(i%Number(beats)===0?1400:1000)});metro.stop();
});
it('aligns a mid-beat seek to the next real project pulse rather than accenting the seek',()=>{
  vi.useFakeTimers();const {context,metro,advance,clicks}=clock();context.currentTime=10;
  metro.start(120,'4/4',{from:1.25,when:10.1});advance(10.3);
  expect(clicks).toHaveLength(1);expect(clicks[0].start.mock.calls[0][0]).toBeCloseTo(10.35);expect(clicks[0].frequency.value).toBe(1000);metro.stop();
});
it('cancels queued sources and skips missed pulses after delayed callbacks',()=>{
  vi.useFakeTimers();const {metro,advance,clicks,gains}=clock();metro.start(120,'4/4');advance(3);
  expect(clicks).toHaveLength(2);expect(clicks[1].start.mock.calls[0][0]).toBeCloseTo(3.02);
  metro.stop();expect(vi.getTimerCount()).toBe(0);for(const click of clicks){expect(click.stop).toHaveBeenLastCalledWith();expect(click.disconnect).toHaveBeenCalled();}for(const disconnect of gains)expect(disconnect).toHaveBeenCalled();
});
it('reconfigures tempo without leaving old clicks behind',()=>{
  vi.useFakeTimers();const {metro,advance,clicks}=clock();metro.start(120,'4/4');const old=clicks[0];
  metro.start(60,'3/4');expect(old.stop).toHaveBeenLastCalledWith();advance(0.95);
  expect(clicks.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(1.02);metro.stop();
});
it('keeps practice pulse phase while aligning song onset and preserving seek offsets',()=>{
  vi.useFakeTimers();const {metro}=clock();metro.start(120,'4/4');
  expect(metro.alignedStart(0,0.25)).toBeCloseTo(0.52);
  expect(metro.alignedStart(0.25,0.25)).toBeCloseTo(0.27);
  metro.stop();expect(metro.alignedStart(0,0.25)).toBeUndefined();
});
it('never queues a pulse at or beyond a finite recording end, even if cleanup is delayed',()=>{
  vi.useFakeTimers();const {metro,advance,clicks}=clock();metro.start(120,'4/4',{from:0,when:.1,until:.75});
  advance(.55);advance(2);
  expect(clicks.map(click=>click.start.mock.calls[0][0])).toEqual([.1,.6]);metro.stop();
});
