import { Lock, LockOpen, Plus, VolumeX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from 'cn'
import { useStudioStore } from '@/stores/studio'
import type { Project, Track } from '@/types/project'

const BEAT_PX = 28
const BAR_PX = BEAT_PX * 4
const TRACK_HEIGHT = 52

const TRACK_COLORS: Record<string, string> = {
  vocal: 'var(--color-waveform)',
  drums: '#f59e0b',
  instrument: '#38bdf8',
  audio: '#34d399',
  midi: '#c084fc',
}

function trackColor(track: Track) {
  return track.color ?? TRACK_COLORS[track.kind] ?? 'var(--color-waveform)'
}

function maxEndBeat(project: Project) {
  const end = project.document.tracks
    .flatMap((track) => track.clips)
    .reduce((max, clip) => Math.max(max, clip.start_beat + clip.length_beats), 0)
  return Math.max(32, Math.ceil(end / 4) * 4 + 16)
}

interface ArrangementProps {
  project: Project
  onToggleLock: (track: Track) => void
  onAddTrack: () => void
  onSelect: (trackId: string, clipId: string) => void
}

export function Arrangement({ project, onToggleLock, onAddTrack, onSelect }: ArrangementProps) {
  const positionBeats = useStudioStore((state) => state.positionBeats)
  const selectedClipId = useStudioStore((state) => state.selectedClipId)
  const tracks = project.document.tracks
  const totalBeats = maxEndBeat(project)
  const bars = Math.ceil(totalBeats / 4)

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 border-b border-border/70 bg-card/30">
        <div className="flex w-56 shrink-0 items-center justify-between border-r border-border/70 px-3">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Tracks</span>
          <Button variant="ghost" size="icon-xs" onClick={onAddTrack} aria-label="Add track">
            <Plus />
          </Button>
        </div>
        <div className="relative flex-1 overflow-hidden">
          {Array.from({ length: bars }, (_, bar) => (
            <div
              key={bar}
              className={cn(
                'absolute top-0 flex h-full items-center pl-1.5 text-[10px] text-muted-foreground/80',
                bar % 4 === 0 && 'font-medium text-muted-foreground',
              )}
              style={{ left: bar * BAR_PX, width: BAR_PX }}
            >
              {bar + 1}
            </div>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-w-fit">
          <div className="w-56 shrink-0 border-r border-border/70">
            {tracks.length === 0 && (
              <div className="flex h-[52px] items-center px-3 text-xs text-muted-foreground">No tracks yet</div>
            )}
            {tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 border-b border-border/50 px-3"
                style={{ height: TRACK_HEIGHT }}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: trackColor(track) }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{track.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    {track.kind}
                    {track.clips.length > 0 && ` · ${track.clips.length} clip${track.clips.length > 1 ? 's' : ''}`}
                  </p>
                </div>
                {track.muted && <VolumeX className="size-3.5 text-muted-foreground" />}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onToggleLock(track)}
                  aria-label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
                >
                  {track.locked ? <Lock className="text-primary" /> : <LockOpen className="text-muted-foreground" />}
                </Button>
              </div>
            ))}
          </div>

          <div className="relative flex-1" style={{ height: Math.max(tracks.length * TRACK_HEIGHT, 272) }}>
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to right, color-mix(in oklch, var(--border) 55%, transparent) 1px, transparent 1px)',
                backgroundSize: `${BAR_PX}px 100%, ${BEAT_PX}px 100%`,
              }}
            />
            {tracks.map((track) => (
              <div
                key={track.id}
                className="relative border-b border-border/50"
                style={{ height: TRACK_HEIGHT }}
              >
                {track.clips.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => onSelect(track.id, clip.id)}
                    className={cn(
                      'absolute top-1 flex h-[44px] flex-col items-stretch overflow-hidden rounded-[2px] border text-left text-[10px] transition-shadow',
                      selectedClipId === clip.id
                        ? 'border-primary/80 shadow-[0_0_0_1px_var(--primary)]'
                        : 'border-white/10 hover:border-white/30',
                    )}
                    style={{
                      left: clip.start_beat * BEAT_PX,
                      width: Math.max(clip.length_beats * BEAT_PX, 24),
                      background: `linear-gradient(180deg, color-mix(in oklch, ${trackColor(track)} 38%, transparent), color-mix(in oklch, ${trackColor(track)} 16%, transparent))`,
                    }}
                    aria-label={`${clip.name}, ${clip.length_beats} beats`}
                  >
                    <span className="flex h-4 shrink-0 items-center gap-1 border-b border-white/10 bg-white/10 px-1 font-medium text-white/90">
                      <span className="truncate">{clip.name}</span>
                      {clip.locked && <Lock className="ml-auto size-2.5 shrink-0" />}
                    </span>
                    <span className="pointer-events-none flex min-h-0 flex-1 items-center px-1 text-[9px] text-white/40">
                      {clip.asset_id ? (clip.kind === 'midi' ? 'MIDI' : 'Audio') : 'Empty clip'}
                    </span>
                  </button>
                ))}
              </div>
            ))}

            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px"
              style={{ left: positionBeats * BEAT_PX, background: 'var(--color-playhead)' }}
            >
              <span
                className="absolute -top-0.5 -left-1 size-2.5 rotate-45 rounded-[2px]"
                style={{ background: 'var(--color-playhead)' }}
              />
            </div>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
