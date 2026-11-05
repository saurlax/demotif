import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Play, Square, Download, RotateCcw, Pause } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { selectClass } from './controls'
import { VocalRecorder, type VocalTake, type RecordingPhase } from '@/audio/vocal-recorder'
import type { Project, Source, Clip } from '@/types/project'
import type { ReferenceSnapshot } from './reference-recording'
import { vocalRecordingCues, recordingOrigin, recordingBarSeconds } from './vocal-recording-cues'
import { requestDiscard } from '@/lib/navigation'
import { notifyError } from '@/lib/notifications'

const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${(Math.max(0, seconds) % 60).toFixed(1).padStart(4, '0')}`
export function VocalRecordingDialog({ project, source, clip, onClose, onState, onSave }: {
  project: Project; source: Source; clip?: Clip; onClose: () => void
  onState: (dirty: boolean) => void
  onSave: (take: VocalTake, snapshot: ReferenceSnapshot) => Promise<void>
}) {
  const [snapshot] = useState<ReferenceSnapshot>(() => ({ source_id: source.id, project_id: project.id,
    project_version: project.version, tempo: project.document.tempo, time_signature: project.document.time_signature,
    source_origin_beat: recordingOrigin(clip), cues: vocalRecordingCues(source, project.document.tempo) }))
  const [phase, setPhase] = useState<RecordingPhase>('idle'), [position, setPosition] = useState(0), [level, setLevel] = useState(0)
  const [take, setTake] = useState<VocalTake>(), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [device, setDevice] = useState(''), [audible, setAudible] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const audio = useRef<HTMLAudioElement>(null), ruler = useRef<HTMLDivElement>(null)
  const mounted = useRef(true), closePending = useRef(false), captureVersion = useRef(project.version)
  const duration = source.duration * 60 / snapshot.tempo
  const active = phase === 'preparing' || phase === 'count-in' || phase === 'recording'
  const dirty = active || saving || (!!take && !saved)
  const [recorder] = useState(() => new VocalRecorder({
    phase: setPhase, progress: setPosition, level: setLevel,
    take: (next) => { setTake(next); setSaved(false); setPosition(0) },
    error: (error) => notifyError(error.message),
  }))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recorder.dispose() } }, [recorder])
  useEffect(() => { onState(dirty); return () => onState(false) }, [dirty, onState])
  useEffect(() => {
    const hidden = () => { if (document.hidden && (phase === 'recording' || phase === 'count-in')) recorder.stop(true) }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [phase, recorder])
  useEffect(() => {
    if (project.version !== captureVersion.current && active) {
      recorder.stop(true)
      notifyError('The project changed. Recording stopped; the take keeps its original lyric timing.')
    }
  }, [project.version, snapshot.project_version, active, recorder])
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let valid = true
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then((all) => {
      if (valid) setDevices(all.filter((d) => d.kind === 'audioinput'))
    }).catch(() => {}) }
    refresh(); navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => { valid = false; navigator.mediaDevices.removeEventListener('devicechange', refresh) }
  }, [phase])
  function prepare() {
    captureVersion.current = project.version
    audio.current?.pause(); setReviewing(false)
    void recorder.prepare(device || undefined)
  }
  useEffect(() => {
    if (!reviewing) return
    let frame = 0
    const tick = () => { if (audio.current) setPosition(audio.current.currentTime); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reviewing])
  const takeUrl = useMemo(() => take ? URL.createObjectURL(take.blob) : undefined, [take])
  useEffect(() => () => { if (takeUrl) URL.revokeObjectURL(takeUrl) }, [takeUrl])
  const peaks = useMemo(() => {
    if (!take) return []
    const count = 240, stride = Math.max(1, Math.ceil(take.pcm.length / count))
    return Array.from({ length: count }, (_, i) => {
      let peak = 0
      for (let j = i * stride; j < Math.min((i + 1) * stride, take.pcm.length); j++) peak = Math.max(peak, Math.abs(take.pcm[j]))
      return peak
    })
  }, [take])
  useEffect(() => {
    const element = ruler.current
    if (element) element.scrollLeft = Math.max(0, position * 100 - element.clientWidth * .4)
  }, [position, phase, reviewing])
  const current = snapshot.cues.filter((c) => c.start <= position && c.end > position)
  const next = snapshot.cues.filter((c) => c.start > position).slice(0, 8)
  async function close() {
    if (saving || closePending.current) return
    closePending.current = true
    const discard = !dirty || await requestDiscard()
    closePending.current = false
    if (!discard || !mounted.current) return
    recorder.dispose(); audio.current?.pause(); onClose()
  }
  return <Dialog open onOpenChange={(open, details) => {
    if (!open) { details.cancel(); void close() }
  }}>
    <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl" onKeyDown={(e) => { e.stopPropagation() }}>
      <DialogHeader className="pr-8"><DialogTitle>Record reference · {source.name}</DialogTitle>
        <DialogDescription className="sr-only">Sing along with the score cues, review your take, and save or download it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="recording-microphone">Microphone</Label>
          <select id="recording-microphone" className={`${selectClass} w-full`} value={device} disabled={active || phase === 'ready' || saving}
            onChange={(e) => setDevice(e.target.value)}>
            <option value="">System default</option>
            {devices.filter((d) => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </div>
        <Button variant="outline" disabled={active || saving} onClick={prepare}>{phase === 'ready' ? 'Reconnect microphone' : 'Enable microphone'}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <meter aria-label="Microphone input level" min={0} max={1} value={Math.min(1, level * 3)} className="h-3 w-36 accent-playback" />
        <span role="status" className="text-sm text-muted-foreground">{phase === 'ready' ? 'Microphone ready' : phase === 'preparing' ? 'Opening microphone…' : phase === 'count-in' ? 'Count-in' : phase === 'recording' ? 'Recording' : take ? (take.interrupted ? 'Interrupted take' : 'Take ready') : 'Microphone off'}</span>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={audible} disabled={active || saving} onChange={(e) => setAudible(e.target.checked)} />Audible count-in</label>
      </div>
      {audible && <p className="text-sm text-muted-foreground">Use headphones to keep the count-in out of your microphone.</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-y py-4">
        <div className="flex min-h-10 flex-wrap items-center gap-1 text-2xl font-medium" aria-label="Current lyrics">
          {phase === 'count-in' ? <span className="text-primary">{Math.min(Number(snapshot.time_signature.split('/')[0]), Math.max(1, Math.ceil(-position / (60 / snapshot.tempo) * Number(snapshot.time_signature.split('/')[1]) / 4)))}</span>
            : current.length ? current.map((c, i) => <span key={`${c.note_id}-${i}`} className="text-playback">{c.text}</span>) : <span className="text-muted-foreground">—</span>}
          <span className="ml-4 text-base text-muted-foreground">{next.map((c) => c.text).join(' ')}</span>
        </div>
        <span className="transport-position whitespace-nowrap text-base tabular-nums">{time(position)} / {time(take && !active ? take.duration : duration)}</span>
      </div>
      <div ref={ruler} className="overflow-x-auto overscroll-contain" role="region" aria-label="Recording lyric timeline">
        <div className="relative h-28 select-none" style={{ width: Math.max(400, (duration + .25) * 100) }}>
          {Array.from({ length: Math.ceil(source.duration / (Number(snapshot.time_signature.split('/')[0]) * 4 / Number(snapshot.time_signature.split('/')[1]))) }, (_, i) => {
            const beat = i * Number(snapshot.time_signature.split('/')[0]) * 4 / Number(snapshot.time_signature.split('/')[1])
            return <span key={i} className="absolute top-0 h-full border-l pl-1 text-xs text-muted-foreground" style={{ left: beat * 60 / snapshot.tempo * 100 }}>{i + 1}</span>
          })}
          {snapshot.cues.map((c, i) => <div key={i} className={`absolute top-7 flex h-12 items-center border-l px-1 text-sm ${c.start <= position && position < c.end ? 'border-playback text-playback' : 'border-primary/40 text-foreground'} ${c.timing === 'estimated' ? 'border-dashed' : ''}`}
            style={{ left: c.start * 100, width: (c.end - c.start) * 100 }} title={`${c.text} · ${time(c.start)}${c.timing === 'estimated' ? ' · Estimated within-note timing' : ''}`}>
            <span className="whitespace-nowrap">{c.text}</span>
          </div>)}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-playback" style={{ left: Math.max(0, position) * 100 }} />
        </div>
      </div>
      {snapshot.cues.some((c) => c.timing === 'estimated') && <span className="text-xs text-muted-foreground">Dashed cues: estimated timing within a note.</span>}
      {take && <div className="space-y-2">
        <svg viewBox="0 0 480 52" preserveAspectRatio="none" className="h-14 w-full text-primary" role="img" aria-label="Recorded waveform">
          {peaks.map((v, i) => <line key={i} x1={i * 2} x2={i * 2} y1={26 - v * 25} y2={26 + v * 25} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <audio ref={audio} src={takeUrl} onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)} onPlay={() => setReviewing(true)} onPause={() => setReviewing(false)} onEnded={() => setReviewing(false)} />
        <input aria-label="Take playback position" type="range" min={0} max={take.duration} step={.01} value={Math.max(0, Math.min(take.duration, position))}
          disabled={active || saving || phase === 'ready'} className="w-full accent-playback" onChange={(e) => {
            const value = Number(e.target.value); setPosition(value); if (audio.current) audio.current.currentTime = value
          }} />
      </div>}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {phase === 'ready' ? <Button onClick={() => { audio.current?.pause(); setPosition(-recordingBarSeconds(snapshot.tempo, snapshot.time_signature)); try { recorder.record(snapshot.tempo, snapshot.time_signature, duration, audible) } catch (e) { notifyError(String(e)) } }}><Mic />Record</Button>
          : active ? <Button variant="outline" onClick={() => { if (phase === 'preparing') { recorder.dispose(); setPhase('idle') } else recorder.stop() }}><Square />{phase === 'recording' ? 'Stop' : 'Cancel'}</Button>
            : <Button disabled={saving || !take} onClick={prepare}>
              {take ? <RotateCcw /> : <Mic />}{take ? 'Re-record' : 'Record'}</Button>}
        {phase === 'ready' && <Button variant="ghost" onClick={() => { recorder.dispose(); setPhase('idle'); setLevel(0) }}>Disable microphone</Button>}
        {take && <>
          <Button variant="outline" disabled={active || saving || phase === 'ready'} onClick={() => {
            if (reviewing) audio.current?.pause()
            else void audio.current?.play().catch((e: Error) => notifyError(e.message))
          }}>{reviewing ? <Pause /> : <Play />}{reviewing ? 'Pause' : 'Listen'}</Button>
          <Button variant="ghost" nativeButton={false} render={<a href={takeUrl} download={`${source.name}-reference.wav`} />}><Download />WAV</Button>
          <Button className="ml-auto" disabled={active || saving || saved || phase === 'ready'} onClick={async () => {
            setSaving(true); audio.current?.pause()
            try { await onSave(take, snapshot); if (mounted.current) setSaved(true) }
            catch (e) { notifyError(e instanceof Error ? e.message : String(e)) }
            finally { if (mounted.current) setSaving(false) }
          }}>{saving ? 'Saving…' : saved ? 'Added to draft' : 'Save reference'}</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}
