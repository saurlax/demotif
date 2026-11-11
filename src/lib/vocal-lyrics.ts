import { randomUUID } from '@/shared/id'
import type { Source } from '@/types/project'

// Check Mandarin syllable shape, not a hard-coded voice dictionary. The installed
// voice remains authoritative for its pronunciation inventory at synthesis time.
const pinyin = /^(?:(?:zh|ch|sh|[bpmfdtnlgkhjqxrywzcs])?(?:a|o|e|ai|ei|ao|ou|an|en|ang|eng|ong|er|i|ia|ie|iao|iu|ian|in|iang|ing|iong|u|ua|uo|uai|ui|uan|un|uang|ueng|v|ve|van|vn|ue)|m|n|ng|hm)$/i
export function vocalSyllableError(lyric: string, pronunciation = '', language = 'zh', _mode?: 'single' | 'multiple'): string | undefined {
  if (language === 'ja' && pronunciation.trim() && !/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u.test(pronunciation.normalize('NFKC')))
    return 'Enter Japanese pronunciation in hiragana or katakana, such as あおい.'
  if (language !== 'zh' || lyric.trim() === '-' || lyric.trim() === '_') return
  const tokens = tokenizeVocalLyrics(lyric, language)
  if (tokens.some((text) => !/^\p{Script=Han}$/u.test(text) && !pinyin.test(text)))
    return 'Enter Chinese characters or pinyin syllables separated by spaces.'
  const readings = pronunciation.trim().split(/\s+/).filter(Boolean)
  if (readings.some((text) => !pinyin.test(text))) return 'Enter pinyin syllables without tone marks, such as yin yue.'
  if (readings.length && readings.length !== Math.max(1, tokens.length)) return `Enter ${Math.max(1, tokens.length)} pinyin syllables to match the lyrics.`
}

export function vocalScoreError(source: Source): string | undefined {
  if (!source.vocal) return
  for (const note of [...source.notes].sort((a, b) => a.start - b.start)) {
    const syllable = source.vocal.syllables[note.id]
    if (syllable?.kind !== 'syllable') continue
    const error = vocalSyllableError(syllable.lyric, syllable.pronunciation, source.vocal.language, syllable.mode)
    if (error) return `Beat ${Number((note.start + 1).toFixed(3))}: ${error}`
  }
}

export function tokenizeVocalLyrics(text: string, language: string) {
  const trimmed = text.trim()
  if (!trimmed) return []
  return language === 'zh' ? trimmed.match(/\p{Script=Han}|[^\s\p{Script=Han}]+/gu) ?? [] : trimmed.split(/\s+/)
}

export function assignVocalLyrics(source: Source, text: string): NonNullable<Source['vocal']> {
  const notes = [...source.notes].sort((a, b) => a.start - b.start), vocal = source.vocal!
  const tokens = tokenizeVocalLyrics(text, vocal.language)
  const counts = notes.map((n) => { const old = vocal.syllables[n.id]; return old?.kind === 'syllable' && tokenizeVocalLyrics(old.lyric, vocal.language).length > 1 ? Math.max(1, tokenizeVocalLyrics(old.lyric, vocal.language).length) : 1 })
  const count = counts.reduce((sum, n) => sum + n, 0)
  if (tokens.length !== count) throw new Error(`${tokens.length} syllable${tokens.length === 1 ? '' : 's'} for ${count} syllable slots. Enter ${count} syllables; use - for continuation and _ for blank.`)
  let cursor = 0
  return { ...vocal, syllables: Object.fromEntries(notes.map((note, i) => {
    const group = tokens.slice(cursor, cursor += counts[i]), previous = vocal.syllables[note.id]
    if (group.length === 1 && group[0] === '-') return [note.id, { kind: 'continue' }]
    if (group.length > 1 && group.some((t) => t === '-' || t === '_')) throw new Error('Edit this note to change its within-note syllable grouping.')
    const lyric = group.join(vocal.language === 'zh' && group.every((t) => /^\p{Script=Han}$/u.test(t)) ? '' : ' ')
    const mode = previous?.kind === 'syllable' ? previous.mode : undefined
    const error = vocalSyllableError(lyric === '_' ? '' : lyric, '', vocal.language, mode)
    if (error) throw new Error(error)
    if (previous?.kind === 'syllable' && tokenizeVocalLyrics(previous.lyric, vocal.language).join(' ') === group.join(' ')) return [note.id, previous]
    return [note.id, { kind: 'syllable', lyric: lyric === '_' ? '' : lyric, ...(mode ? { mode } : {}) }]
  })) }
}


export type VocalEntryMode = 'across' | 'multiple'
type Phonemes = Extract<NonNullable<Source['vocal']>['syllables'][string], {kind: 'syllable'}>['phonemes']
export function vocalEntryPreview(source: Source, noteId: string, text: string, mode: VocalEntryMode = 'multiple') {
  const ordered = [...source.notes].sort((a, b) => a.start - b.start)
  const index = ordered.findIndex((n) => n.id === noteId)
  if (index < 0) throw new Error('Select a vocal note')
  const tokens = tokenizeVocalLyrics(text, source.vocal!.language)
  const lyrics = tokens.length ? tokens : ['']
  return { tokens: lyrics, targets: mode === 'multiple' ? [ordered[index]] : ordered.slice(index, index + lyrics.length),
    available: ordered.length - index, overflow: mode === 'multiple' ? 0 : Math.max(0, lyrics.length - ordered.length + index) }
}

export function applyVocalEntry(source: Source, noteId: string, text: string, options: {
  mode?: VocalEntryMode; pronunciation?: string; phonemes?: Phonemes; split?: boolean; newId?: () => string
} = {}): Pick<Source, 'notes' | 'vocal'> {
  const mode = options.split ? 'across' : options.mode ?? 'multiple'
  const vocal = source.vocal!, preview = vocalEntryPreview(source, noteId, text, mode)
  const reading = options.pronunciation?.trim() ?? ''
  const validation = vocalSyllableError(preview.tokens.filter((t) => t !== '-' && t !== '_').join(' '), reading, vocal.language, 'multiple')
  if (validation) throw new Error(validation)
  let notes = source.notes, targets = preview.targets
  const assignments = { ...vocal.syllables }
  if (mode === 'multiple') {
    if (text.trim() === '-') assignments[noteId] = { kind: 'continue' }
    else if (text.trim() === '_') assignments[noteId] = { kind: 'syllable', lyric: '' }
    else {
      if (preview.tokens.some((t) => t === '-' || t === '_') && text.trim()) throw new Error('Use Continue syllable for a sustained syllable, or clear the lyric to leave it blank.')
      assignments[noteId] = { kind: 'syllable', lyric: text.trim(), mode: 'multiple',
        ...(reading ? { pronunciation: reading } : {}), ...(options.phonemes?.length ? { phonemes: options.phonemes } : {}) }
    }
  } else {
    if (preview.overflow && !options.split) throw new Error(`${preview.tokens.length} syllables for ${preview.available} available note${preview.available === 1 ? '' : 's'}. Split the selected note to fit all syllables.`)
    if (options.phonemes?.length && preview.tokens.length > 1) throw new Error('Apply raw phonemes to one note at a time.')
    if (options.split) {
      const original = source.notes.find((n) => n.id === noteId)!
      const duration = original.duration / preview.tokens.length
      targets = preview.tokens.map((_, i) => ({ ...original, id: i === 0 ? original.id : (options.newId ?? (() => randomUUID()))(),
        start: original.start + i * duration, duration: i === preview.tokens.length - 1 ? original.start + original.duration - (original.start + i * duration) : duration }))
      notes = [...source.notes.filter((n) => n.id !== noteId), ...targets].sort((a, b) => a.start - b.start)
    }
    const readings = reading.split(/\s+/).filter(Boolean)
    let readingIndex = 0
    targets.forEach((note, i) => {
      const token = preview.tokens[i]
      if (token === '-') { assignments[note.id] = { kind: 'continue' }; return }
      const lyric = token === '_' ? '' : token, old = vocal.syllables[note.id]
      const previous = !options.split && old?.kind === 'syllable' && old.lyric === lyric ? { ...old } : { kind: 'syllable' as const, lyric }
      delete previous.mode
      if (token !== '_') {
        if (readings[readingIndex]) previous.pronunciation = readings[readingIndex]
        else if (i === 0 && 'pronunciation' in options) delete previous.pronunciation
        readingIndex++
      }
      if (i === 0 && 'phonemes' in options) {
        if (options.phonemes?.length) previous.phonemes = options.phonemes
        else delete previous.phonemes
      }
      assignments[note.id] = previous
    })
  }
  return { notes, vocal: { ...vocal, syllables: assignments } }
}
