import type { Asset, Clip } from './model'
export const assetNotes = (asset: Asset) => asset.notes ?? []
export const partRange = (clip: Clip) => ({
  start: clip.offset,
  end: clip.offset + clip.duration,
  length: clip.duration,
})
