export const SOUND_IDS = [
  'piano',
  'pluck',
  'supersaw',
  'lead',
  'sub',
  'reese',
  'air',
  'strings',
  'electric-piano',
  'guitar',
  'electric-bass',
  'brass',
  'flute',
  'organ',
  'analog-lead',
  'square-lead',
  'fm-bell',
  'mallet',
  'music-box',
  'kalimba',
  'nylon-guitar',
  'clav',
  'acid-bass',
  'fm-bass',
  'organ-bass',
  'warm-pad',
  'choir-pad',
  'glass-pad',
  'string-ensemble',
  'synth-brass',
] as const
export type Sound = (typeof SOUND_IDS)[number]
export const SOUND_NAMES: Record<Sound, string> = {
  piano: 'Piano',
  pluck: 'Glass pluck',
  supersaw: 'Supersaw',
  lead: 'Classic lead',
  sub: 'Sub bass',
  reese: 'Reese bass',
  air: 'Air pad',
  strings: 'Strings',
  'electric-piano': 'Electric piano',
  guitar: 'Guitar',
  'electric-bass': 'Electric bass',
  brass: 'Brass',
  flute: 'Flute',
  organ: 'Organ',
  'analog-lead': 'Analog lead',
  'square-lead': 'Square lead',
  'fm-bell': 'FM bell',
  mallet: 'Mallet',
  'music-box': 'Music box',
  kalimba: 'Kalimba',
  'nylon-guitar': 'Nylon guitar',
  clav: 'Clav',
  'acid-bass': 'Acid bass',
  'fm-bass': 'FM bass',
  'organ-bass': 'Organ bass',
  'warm-pad': 'Warm pad',
  'choir-pad': 'Choir pad',
  'glass-pad': 'Glass pad',
  'string-ensemble': 'String ensemble',
  'synth-brass': 'Synth brass',
}
export const DRUM_KITS = ['studio', '808', '909', 'lofi'] as const
export type DrumKit = (typeof DRUM_KITS)[number]
export const soundCategory = (id: Sound) =>
  id.includes('bass') || id === 'sub' || id === 'reese'
    ? '贝斯'
    : id.includes('pad') || ['air', 'strings', 'string-ensemble'].includes(id)
      ? 'Pad'
      : id.includes('lead') || id === 'supersaw' || id === 'synth-brass'
        ? '合成器'
        : '键盘'
