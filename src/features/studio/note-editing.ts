import type { Source } from '@/types/project'
import type { Note } from '@/types/project'

export const NOTE_GRID = 0.25
export function snapNoteDuration(value: number, limit: number) {
  const maximum = Math.max(Math.min(NOTE_GRID, limit), Math.floor((limit + 1e-8) / NOTE_GRID) * NOTE_GRID)
  return Math.max(Math.min(NOTE_GRID, limit), Math.min(maximum, Math.round(value / NOTE_GRID) * NOTE_GRID))
}
export const formatNoteDuration = (value: number) => `${Number(value.toFixed(2))} beats`

export function removeEditorNote(source: Source, noteId: string): Pick<Source, 'notes' | 'vocal'> {
  const notes = source.notes.filter((n) => n.id !== noteId)
  if (!source.vocal) return { notes }
  const ids = new Set(notes.map((n) => n.id))
  const syllables = Object.fromEntries(Object.entries(source.vocal.syllables).filter(([id]) => ids.has(id)))
  const ordered = [...notes].sort((a, b) => a.start - b.start)
  for (let i = 0; i < ordered.length; i++) {
    if (syllables[ordered[i].id]?.kind !== 'continue') continue
    const previous = ordered[i - 1], parent = previous && syllables[previous.id]
    if (!previous || !parent || (parent.kind === 'syllable' && !parent.lyric.trim()) || Math.abs(previous.start + previous.duration - ordered[i].start) > 1e-6)
      delete syllables[ordered[i].id]
  }
  return { notes, vocal: { ...source.vocal, syllables,
    vibrato: Object.fromEntries(Object.entries(source.vocal.vibrato).filter(([id]) => ids.has(id))),
  } }
}

export function transformNotes(notes:Note[],ids:ReadonlySet<string>,duration:number,delta:{time?:number;pitch?:number;duration?:number}):Note[] {
  const group=notes.filter(n=>ids.has(n.id));if(!group.length)return notes;
  const snap=(v:number)=>Math.round(v/NOTE_GRID)*NOTE_GRID;
  const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
  const time=clamp(snap(delta.time??0),-Math.min(...group.map(n=>n.start)),Math.min(...group.map(n=>duration-n.start-n.duration)));
  const pitch=clamp(Math.round(delta.pitch??0),-Math.min(...group.map(n=>n.pitch)),127-Math.max(...group.map(n=>n.pitch)));
  const length=clamp(snap(delta.duration??0),Math.max(...group.map(n=>Math.min(NOTE_GRID,n.duration)-n.duration)),Math.min(...group.map(n=>duration-n.start-n.duration)));
  return notes.map(n=>ids.has(n.id)?{...n,start:n.start+time,pitch:n.pitch+pitch,duration:n.duration+length}:n);
}

export function marqueeNotes(notes:Note[],box:{start:number;end:number;low:number;high:number}):string[] {
  return notes.filter(n=>n.start<=box.end && n.start+n.duration>=box.start && n.pitch>=box.low && n.pitch<=box.high).map(n=>n.id);
}

export function removeSelectedNotes(source:Source,ids:ReadonlySet<string>):Pick<Source,'notes'|'vocal'> {
  let result=source;for(const id of ids)result={...result,...removeEditorNote(result,id)};return {notes:result.notes,...(result.vocal?{vocal:result.vocal}:{})};
}
