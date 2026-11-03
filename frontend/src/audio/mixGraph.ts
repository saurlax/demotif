import type { Project, TrackEffects } from './model'
import { createMaster, createTrackBus } from './effects'
import { defaultMixer, mixerOrder } from './mixer'

export function createMixGraph(
  ctx: BaseAudioContext,
  destination: AudioNode,
  project: Project,
  from: number,
  when: number,
  loop?: { start: number; length: number; phase: number },
) {
  const mixer = project.mixer ?? defaultMixer()
  const ordered = mixerOrder(mixer.buses)
  const ids = new Set(mixer.buses.map((b) => b.id))
  if (project.tracks.some((t) => t.busId && !ids.has(t.busId)))
    throw new Error('音轨的混音总线不存在')
  const disposers: (() => void)[] = []
  try {
    const limiter = createMaster(ctx, destination)
    disposers.push(limiter.dispose)
    const master = createTrackBus(
      ctx,
      limiter.input,
      mixer.master.gain,
      mixer.master.effects,
      project.bpm,
      from,
      when,
      mixer.master.automationBypassed ? [] : mixer.master.automation,
      loop,
    )
    disposers.push(master.dispose)
    const buses = new Map<string, AudioNode>()
    for (const b of ordered) {
      const bus = createTrackBus(
        ctx,
        b.busId ? buses.get(b.busId)! : master.input,
        b.gain,
        b.effects,
        project.bpm,
        from,
        when,
        b.automationBypassed ? [] : b.automation,
        loop,
      )
      buses.set(b.id, bus.input)
      disposers.push(bus.dispose)
    }
    return {
      track: (
        _id: string,
        gain: number,
        effects?: TrackEffects,
        busId?: string,
      ) => {
        const bus = createTrackBus(
          ctx,
          busId ? buses.get(busId)! : master.input,
          gain,
          effects,
          project.bpm,
          from,
          when,
        )
        disposers.push(bus.dispose)
        return bus.input
      },
      dispose: () => {
        for (const dispose of disposers.reverse()) dispose()
      },
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
}
