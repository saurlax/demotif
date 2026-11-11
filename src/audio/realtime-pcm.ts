/** Streaming box-filter resampling: preserves partial windows across worklet blocks. */
export class RealtimePCMEncoder {
  private sum=0;
  private filled=0;
  private frame:number[]=[];
  readonly ratio:number;
  constructor(sourceRate:number,readonly targetRate=24000){
    if(!Number.isFinite(sourceRate)||sourceRate<=0||targetRate<=0)throw new Error('Invalid voice sample rate');
    this.ratio=sourceRate/targetRate;
  }
  push(input:Float32Array){
    const chunks:Uint8Array[]=[];
    for(const value of input){
      let remaining=1;
      while(remaining>1e-8){
        const weight=Math.min(remaining,this.ratio-this.filled);
        this.sum+=(Number.isFinite(value)?value:0)*weight;this.filled+=weight;remaining-=weight;
        if(this.filled+1e-8>=this.ratio){
          const sample=Math.max(-1,Math.min(1,this.sum/this.ratio));
          this.frame.push(Math.round(sample*(sample<0?32768:32767)));this.sum=0;this.filled=0;
          if(this.frame.length===this.targetRate/50){
            const bytes=new Uint8Array(this.frame.length*2),view=new DataView(bytes.buffer);
            this.frame.forEach((n,i)=>view.setInt16(i*2,n,true));chunks.push(bytes);this.frame=[];
          }
        }
      }
    }
    return chunks;
  }
  reset(){this.sum=0;this.filled=0;this.frame=[]}
}
export function pcmBase64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
export function decodePCM(base64:string){
  const binary=atob(base64);
  if(binary.length%2)throw new Error('Incomplete PCM16 sample');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),samples=new Float32Array(bytes.length/2);
  for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
  return samples;
}
export class RealtimeResponseGate {
  private responses=new Set<string>();
  private discarded=new Set<string>();
  begin(id:string){this.responses.add(id)}
  interrupt(){for(const id of this.responses)this.discarded.add(id)}
  accepts(id:string){return this.responses.has(id)&&!this.discarded.has(id)}
}
