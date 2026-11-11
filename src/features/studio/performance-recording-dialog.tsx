import {useEffect,useState} from 'react';
import {Download} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {selectClass} from './controls';
import type {CountIn} from '@/audio/performance-timing';
import type {usePerformanceRecording} from './use-performance-recording';

export function PerformanceRecordingDialog({recording}:{recording:ReturnType<typeof usePerformanceRecording>}){
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
  useEffect(()=>{
    if(!recording.settings||!navigator.mediaDevices?.enumerateDevices)return;
    let active=true;
    const refresh=()=>void navigator.mediaDevices.enumerateDevices().then(all=>{if(active)setDevices(all.filter(d=>d.kind==='audioinput'))}).catch(()=>{});
    refresh();navigator.mediaDevices.addEventListener('devicechange',refresh);
    return()=>{active=false;navigator.mediaDevices.removeEventListener('devicechange',refresh)};
  },[recording.settings]);
  return <Dialog open={recording.settings} onOpenChange={recording.setSettings}>
    <DialogContent className="sm:max-w-md" onKeyDown={e=>e.stopPropagation()}>
      <DialogHeader><DialogTitle>Recording settings</DialogTitle><DialogDescription className="sr-only">Choose a microphone and count-in. Recorded audio is added to a new track at the playhead.</DialogDescription></DialogHeader>
      <div className="min-w-0 space-y-2"><Label htmlFor="performance-mic">Microphone</Label>
        <select id="performance-mic" className={`${selectClass} w-full`} value={recording.device} disabled={recording.busy} onChange={e=>recording.setDevice(e.target.value)}>
          <option value="">System default</option>{devices.filter(d=>d.deviceId).map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Microphone ${i+1}`}</option>)}
        </select>
      </div>
      <div className="space-y-2"><Label htmlFor="performance-count-in">Count-in</Label>
        <select id="performance-count-in" className={`${selectClass} w-full`} value={recording.countIn} disabled={recording.busy} onChange={e=>recording.setCountIn(e.target.value as CountIn)}>
          <option value="none">None</option><option value="four">4 beats</option><option value="bar">1 bar</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">Use headphones to keep accompaniment out of the microphone.</p>
      {recording.failed?<div className="flex flex-wrap gap-2">
        <Button disabled={recording.saving} onClick={()=>void recording.retry()}>Retry</Button>
        <Button variant="outline" onClick={recording.download}><Download/>Download WAV</Button>
        <Button variant="ghost" disabled={recording.saving} onClick={recording.discard}>Discard</Button>
      </div>:<Button onClick={()=>recording.setSettings(false)}>Done</Button>}
    </DialogContent>
  </Dialog>;
}
