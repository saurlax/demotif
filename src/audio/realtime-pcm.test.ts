import {expect,it} from 'vitest';
import {RealtimePCMEncoder,pcmBase64,decodePCM,RealtimeResponseGate} from './realtime-pcm';

it.each([44100,48000,24000])('preserves PCM duration and block continuity at %d Hz',rate=>{
  const input=Float32Array.from({length:rate},(_,i)=>Math.sin(i*2*Math.PI*220/rate)*0.5);
  const whole=new RealtimePCMEncoder(rate).push(input);
  const encoder=new RealtimePCMEncoder(rate),split:Uint8Array[]=[];
  for(let i=0;i<input.length;i+=128)split.push(...encoder.push(input.subarray(i,i+128)));
  expect(split).toEqual(whole);expect(split).toHaveLength(50);
  expect(split.reduce((n,b)=>n+b.length,0)).toBe(48000);
});
it('clips samples, writes little endian, and rejects incomplete output frames',()=>{
  const encoder=new RealtimePCMEncoder(24000),input=new Float32Array(480);input[0]=2;input[1]=-2;
  const bytes=encoder.push(input)[0];expect([...bytes.slice(0,4)]).toEqual([255,127,0,128]);
  const decoded=decodePCM(pcmBase64(bytes));expect(decoded[0]).toBeCloseTo(1,3);expect(decoded[1]).toBe(-1);
  expect(()=>decodePCM('AA==')).toThrow('Incomplete');
});
it('discards delayed audio from interrupted responses including already completed playback',()=>{
  const gate=new RealtimeResponseGate();gate.begin('old');expect(gate.accepts('old')).toBe(true);
  gate.interrupt();gate.begin('new');expect(gate.accepts('old')).toBe(false);expect(gate.accepts('unknown')).toBe(false);expect(gate.accepts('new')).toBe(true);
});
