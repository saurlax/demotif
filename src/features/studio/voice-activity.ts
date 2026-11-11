export class VoiceActivity {
  private started:number
  private previous:number
  private lastLoud:number
  private speechMs=0
  constructor(now:number){this.started=now;this.previous=now;this.lastLoud=now}
  get heardSpeech(){return this.speechMs>=180}
  sample(rms:number,now:number):'continue'|'finish'|'restart'{
    const elapsed=Math.max(0,Math.min(100,now-this.previous));this.previous=now
    if(rms>0.02){this.speechMs+=elapsed;this.lastLoud=now}
    if(this.heardSpeech&&now-this.lastLoud>=850)return 'finish'
    // Rotate silent buffers without uploading them or ending the conversation.
    if(!this.heardSpeech&&now-this.started>=15000)return 'restart'
    return 'continue'
  }
}
