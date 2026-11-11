import { resolveVocalProject } from '@/audio/vocal-resolution'
import { uploadDirect } from '@/lib/direct-media'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from '@/audio/audio'
import { renderProject } from '@/audio/adapter'
import { useStudioStore } from '@/stores/studio'
import type { Project } from '@/types/project'

export function useAudioSession(
  project: Project | undefined,
  onError: (message: string) => void,
) {
  const [engine] = useState(() => new AudioEngine())
  const playing = useStudioStore((s) => s.playing)
  const performance=useStudioStore(s=>s.performance)
  const metronome = useStudioStore((s) => s.metronome)
  const tempo=project?.document.tempo,meter=project?.document.time_signature,projectId=project?.id
  const [preparing, setPreparing] = useState(false)
  const [playRequest,setPlayRequest]=useState(0)
  const requested=useRef<{resolve:()=>void;reject:(error:Error)=>void}|null>(null)
  const rendered = useMemo(
    () => (project ? renderProject(project) : undefined),
    [project],
  )
  const endSeconds = useMemo(
    () =>
      Math.max(
        1,
        ...(rendered?.tracks.flatMap((t) =>
          t.clips.map((c) => c.start + c.duration),
        ) ?? []),
      ),
    [rendered],
  )
  const preparedEnd = useRef(endSeconds)
  const playbackGeneration = useRef(0)
  const current = useRef(project)
  const errorRef = useRef(onError)
  useEffect(() => {
    current.current = project
    errorRef.current = onError
  }, [project, onError])
  useEffect(() => {
    useStudioStore.getState().stop()
    return () => {
      requested.current?.reject(new Error('The project was closed.'));requested.current=null
      engine.stop()
      engine.stopPart()
      engine.stopAudition()
      engine.release()
    }
  }, [engine, project?.id])
  useEffect(()=>{
    if(tempo&&meter)engine.configureMetronome(useStudioStore.getState().metronome,tempo,meter)
    return()=>engine.stopMetronome()
  },[engine,metronome,projectId,tempo,meter])
  useEffect(()=>{
    const hidden=()=>{if(document.hidden){engine.stopMetronome();useStudioStore.getState().setMetronome(false)}}
    document.addEventListener('visibilitychange',hidden)
    return()=>document.removeEventListener('visibilitychange',hidden)
  },[engine])
  useEffect(() => {
    if(performance){requested.current?.reject(new Error('Recording took over playback.'));requested.current=null;setPreparing(false);return}
    if (!playing || !project || !rendered) {
      requested.current?.reject(new Error('Playback was cancelled.'));requested.current=null
      engine.stop()
      setPreparing(false)
      return
    }
    playbackGeneration.current++
    let active = true,
      frame = 0
    setPreparing(true)
    const start = async (from: number) => {
      const prepared = await resolveVocalProject(project)
      if (!active) return
      preparedEnd.current = Math.max(1, ...prepared.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)))
      const started=await engine.play(prepared, from)
      if (!active) return
      if(!started)throw new Error('Playback preparation was cancelled.')
      requested.current?.resolve();requested.current=null
      setPreparing(false)
      const tick = () => {
        if (!active) return
        const position = engine.position(),
          end = preparedEnd.current
        if (position >= end) {
          useStudioStore.getState().stop()
          return
        }
        useStudioStore
          .getState()
          .setPosition((position * project.document.tempo) / 60)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    const fail = (e: unknown) => {
      if (active) {
        requested.current?.reject(e instanceof Error?e:new Error('Playback failed'));requested.current=null
        useStudioStore.getState().togglePlayback()
        errorRef.current(e instanceof Error ? e.message : 'Playback failed')
        setPreparing(false)
      }
    }
    void start(
      (useStudioStore.getState().positionBeats * 60) / project.document.tempo,
    ).catch(fail)
    return () => {
      active = false
      playbackGeneration.current++
      cancelAnimationFrame(frame)
      if(!useStudioStore.getState().performance)engine.stop()
    }
  }, [engine, playing, rendered, project, endSeconds,performance,playRequest])
  function playFrom(beats?:number){
    if(!current.current)return Promise.reject(new Error('Open a project before playback.'))
    if(useStudioStore.getState().performance)return Promise.reject(new Error('Finish recording before playback.'))
    requested.current?.reject(new Error('Playback request was replaced.'))
    return new Promise<void>((resolve,reject)=>{
      requested.current={resolve,reject}
      if(beats!==undefined)useStudioStore.getState().setPosition(beats)
      useStudioStore.getState().setPlaying(true);setPlayRequest(n=>n+1)
    })
  }
  function seek(beats: number) {
    const state = useStudioStore.getState()
    if(state.performance)return
    state.setPosition(beats)
    const generation = ++playbackGeneration.current
    if (state.playing && current.current)
      void resolveVocalProject(current.current).then((prepared) => {
        if (generation !== playbackGeneration.current || !useStudioStore.getState().playing) return
        return engine.play(prepared, (beats * 60) / (current.current?.document.tempo ?? 120))
      })
        .catch((e) => errorRef.current(String(e)))
  }
  function toggleMetronome(){
    const enabled=!useStudioStore.getState().metronome
    if(!enabled)engine.stopMetronome()
    else {
      try{
        void engine.getContext().resume().catch(()=>{
          engine.stopMetronome();useStudioStore.getState().setMetronome(false)
          errorRef.current('Cannot start the metronome. Enable browser audio and try again.')
        })
      }catch{
        errorRef.current('Cannot start the metronome. Enable browser audio and try again.')
        return
      }
    }
    useStudioStore.getState().setMetronome(enabled)
  }
  function stop(){requested.current?.reject(new Error('Playback stopped.'));requested.current=null;engine.stop();useStudioStore.getState().stop()}
  async function exportWav() {
    if (!project || !rendered) return
    const prepared = await resolveVocalProject(project, { synthesize: true })
    const blob = await engine.export(prepared, Math.max(1, ...prepared.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)))),
      url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name}.wav`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    try { await uploadDirect(project.id,blob,`${project.name}.wav`,'export',project.version) }
    catch { throw new Error('WAV downloaded, but the shared export could not be saved.') }
  }
  return { engine, preparing, seek, exportWav, toggleMetronome, stop,playFrom }
}
