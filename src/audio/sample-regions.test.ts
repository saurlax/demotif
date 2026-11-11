import {expect,it} from 'vitest';
import {synthesize,renderVoice,SYNTH_RATE} from './voices';
import {sourceSchema} from '@/shared/schema';
import {renderSource} from './adapter';
import {transformNotes} from '@/features/studio/note-editing';
import type {Asset} from './model';
const asset:Asset={id:'regions',name:'Regions',kind:'keys',variant:0,duration:1,sampler:{rootNote:60,loopStart:0,loopEnd:1},synth:{attack:0,release:0,cutoff:20000},notes:[{id:'n',pitch:72,start:0,duration:1,velocity:1,sample:{offset:.5,duration:.2,rootNote:72}}]};
it('plays only a note window and stops without reading neighbouring or looping material',()=>{
 const data=new Float32Array(SYNTH_RATE);data.fill(1,0,SYNTH_RATE/2);data.fill(-1,SYNTH_RATE/2);
 const out=synthesize(asset,{data,rate:SYNTH_RATE});expect(out[Math.floor(.05*SYNTH_RATE)]).toBeLessThan(-.9);expect(out[Math.floor(.3*SYNTH_RATE)]).toBe(0);
 const outside=synthesize({...asset,notes:[{...asset.notes![0],sample:{offset:2,duration:1,rootNote:72}}]},{data,rate:SYNTH_RATE});expect(outside.every(x=>x===0)).toBe(true);
});
it('uses each captured root for transposition and preserves stereo windows',()=>{
 const data=Float32Array.from({length:SYNTH_RATE},(_,i)=>Math.sin(i*2*Math.PI*220/SYNTH_RATE));
 const crossings=(v:Float32Array)=>v.slice(200,1800).reduce((n,x,i,a)=>n+(i>0&&x>=0&&a[i-1]<0?1:0),0);
 const pcm=synthesize(asset,{data,rate:SYNTH_RATE}),up=synthesize({...asset,notes:[{...asset.notes![0],pitch:84}]},{data,rate:SYNTH_RATE});expect(crossings(up)).toBeGreaterThan(crossings(pcm)*1.7);
 const stereo=renderVoice(asset,{data,right:Float32Array.from(data,x=>-x),rate:SYNTH_RATE});expect(stereo.right![2000]).toBeCloseTo(-stereo.pcm[2000],5);
});
it('keeps source windows in seconds across tempo conversion and rejects unsupported mapping',()=>{
 const source=sourceSchema.parse({id:'s',kind:'notes',asset_id:'owned',duration:8,sampler:{rootNote:60},notes:[{id:'n',pitch:60,start:4,duration:2,sample:{offset:12.5,duration:.3,rootNote:60}}]});
 expect(renderSource(sourceSchema.parse({...source,kind:'drums'}),'project',120)).toMatchObject({kind:'drums',notes:[{sample:{offset:12.5,duration:.3,rootNote:60}}]});
 const moved=transformNotes(source.notes,new Set(['n']),16,{time:2,pitch:12})[0];expect(moved).toMatchObject({start:6,pitch:72,sample:{offset:12.5,duration:.3,rootNote:60}});
 const rendered=renderSource(source,'project',120);expect(rendered.notes![0]).toMatchObject({start:2,duration:1,sample:{offset:12.5,duration:.3,rootNote:60}});
 expect(()=>sourceSchema.parse({...source,asset_id:null})).toThrow();expect(()=>sourceSchema.parse({...source,notes:[{...source.notes[0],sample:{offset:-1,duration:.3,rootNote:60}}]})).toThrow();
});
