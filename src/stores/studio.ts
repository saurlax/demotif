import { create } from 'zustand'

interface StudioState {
  playing: boolean
  positionBeats: number
  selectedTrackId: string | null
  selectedClipId: string | null
  togglePlayback: () => void
  stop: () => void
  setPosition: (beats: number) => void
  select: (trackId: string | null, clipId?: string | null) => void
}

export const useStudioStore = create<StudioState>((set) => ({
  playing: false,
  positionBeats: 0,
  selectedTrackId: null,
  selectedClipId: null,
  togglePlayback: () => set((state) => ({ playing: !state.playing })),
  stop: () => set({ playing: false, positionBeats: 0 }),
  setPosition: (beats) => set({ positionBeats: Math.max(0, beats) }),
  select: (trackId, clipId = null) => set({ selectedTrackId: trackId, selectedClipId: clipId }),
}))
