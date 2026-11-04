import { resolveVocalProject } from '@/audio/vocal-resolution'
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
  const [preparing, setPreparing] = useState(false)
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
      engine.stop()
      engine.stopPart()
      engine.stopAudition()
      engine.release()
    }
  }, [engine, project?.id])
  useEffect(() => {
    if (!playing || !project || !rendered) {
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
      await engine.play(prepared, from)
      if (!active) return
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
      engine.stop()
    }
  }, [engine, playing, rendered, project, endSeconds])
  function seek(beats: number) {
    const state = useStudioStore.getState()
    state.setPosition(beats)
    const generation = ++playbackGeneration.current
    if (state.playing && current.current)
      void resolveVocalProject(current.current).then((prepared) => {
        if (generation !== playbackGeneration.current || !useStudioStore.getState().playing) return
        return engine.play(prepared, (beats * 60) / (current.current?.document.tempo ?? 120))
      })
        .catch((e) => errorRef.current(String(e)))
  }
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
  }
  return { engine, preparing, seek, exportWav }
}
