import { create } from 'zustand'

interface StudioState {
  playing: boolean
  metronome: boolean
  performance: boolean
  positionBeats: number
  selectedTrackId: string | null
  selectedClipId: string | null
  togglePlayback: () => void
  setMetronome: (enabled: boolean) => void
  setPerformance: (active:boolean) => void
  setPlaying: (playing:boolean) => void
  stop: () => void
  setPosition: (beats: number) => void
  select: (trackId: string | null, clipId?: string | null) => void
}

export const useStudioStore = create<StudioState>((set) => ({
  playing: false,
  metronome: false,
  performance: false,
  positionBeats: 0,
  selectedTrackId: null,
  selectedClipId: null,
  togglePlayback: () => set((state) => ({ playing: !state.playing })),
  setMetronome: (metronome) => set({metronome}),
  setPerformance: (performance) => set({performance}),
  setPlaying: (playing) => set({playing}),
  stop: () => set({ playing: false, positionBeats: 0, metronome: false }),
  setPosition: (beats) => set({ positionBeats: Math.max(0, beats) }),
  select: (trackId, clipId = null) => set({ selectedTrackId: trackId, selectedClipId: clipId }),
}))
