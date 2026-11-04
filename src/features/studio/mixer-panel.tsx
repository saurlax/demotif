import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField, selectClass } from './controls'
import type { Project, ProducerCommand, Channel } from '@/types/project'
import type { TrackEffects } from '@/audio/model'

const effectFields: [
  keyof TrackEffects,
  string,
  number,
  number,
  number,
  number,
][] = [
  ['pan', 'Pan', -1, 1, 0.05, 0],
  ['highpass', 'High pass · Hz', 20, 20000, 20, 20],
  ['lowpass', 'Low pass · Hz', 20, 20000, 20, 20000],
  ['lowShelf', 'Low shelf · dB', -12, 12, 0.5, 0],
  ['highShelf', 'High shelf · dB', -12, 12, 0.5, 0],
  ['drive', 'Drive', 0, 1, 0.05, 0],
  ['reverb', 'Reverb', 0, 1, 0.05, 0],
  ['delay', 'Delay', 0, 1, 0.05, 0],
  ['sidechain', 'Sidechain', 0, 1, 0.05, 0],
  ['chorus', 'Chorus', 0, 1, 0.05, 0],
  ['phaser', 'Phaser', 0, 1, 0.05, 0],
  ['tremolo', 'Tremolo', 0, 1, 0.05, 0],
  ['autopan', 'Auto pan', 0, 1, 0.05, 0],
  ['bitcrusher', 'Bit depth', 0, 1, 0.05, 0],
  ['width', 'Stereo width', 0, 2, 0.05, 1],
  ['air', 'Air', 0, 1, 0.05, 0],
  ['softClip', 'Soft clip', 0, 1, 0.05, 0],
  ['multiband', 'Multiband', 0, 1, 0.05, 0],
  ['threshold', 'Threshold · dB', -100, 0, 1, -24],
  ['ratio', 'Ratio', 1, 20, 0.5, 4],
  ['compAttack', 'Attack · s', 0, 1, 0.001, 0.003],
  ['compRelease', 'Release · s', 0, 1, 0.01, 0.25],
]
export function MixerPanel({
  project,
  commit,
  initialId,
  onClose,
}: {
  project: Project
  commit: (c: ProducerCommand[]) => Promise<void>
  initialId?: string
  onClose: () => void
}) {
  const [id, setId] = useState(initialId ?? 'master')
  const track = project.document.tracks.find((t) => t.id === id),
    mixer = project.document.mixer
  const channel = track ?? mixer.buses.find((b) => b.id === id) ?? mixer.master
  function update(patch: Partial<Channel>) {
    if (track)
      void commit([{ type: 'track.update', track_id: track.id, ...patch }])
    else
      void commit([
        {
          type: 'mixer.set',
          mixer: {
            ...mixer,
            ...(channel.id === 'master'
              ? { master: { ...(channel as Channel), ...patch } }
              : {
                  buses: mixer.buses.map((b) =>
                    b.id === channel.id ? { ...b, ...patch } : b,
                  ),
                }),
          },
        },
      ])
  }
  return (
    <section
      className="flex h-full min-h-0 flex-col border-t bg-background"
      aria-label="Mixer"
    >
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <span className="text-sm font-medium">Mixer</span>
        <select
          className={`${selectClass} max-w-40`}
          aria-label="Mix channel"
          value={channel.id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="master">Master</option>
          {mixer.buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          {project.document.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const bus = {
              id: crypto.randomUUID(),
              name: `Bus ${mixer.buses.length + 1}`,
              gain: 1,
              effects: {},
              bus_id: null,
              automation: [],
              automation_bypassed: false,
            }
            void commit([
              {
                type: 'mixer.set',
                mixer: { ...mixer, buses: [...mixer.buses, bus] },
              },
            ])
            setId(bus.id)
          }}
        >
          <Plus />
          Bus
        </Button>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-xs"
          aria-label="Close mixer"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <Input
            className="h-8 w-40"
            aria-label="Channel name"
            data-saved-value={channel.name}
            key={channel.id + channel.name}
            defaultValue={channel.name}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== channel.name)
                update({ name: e.target.value })
            }}
          />
          <div className="w-40">
            <NumberField
              label="Gain"
              value={channel.gain}
              min={0}
              max={2}
              step={0.05}
              onChange={(gain) => update({ gain })}
            />
          </div>
          {channel.id !== 'master' && (
            <label className="text-sm text-muted-foreground">
              Output{' '}
              <select
                className={selectClass}
                value={channel.bus_id ?? ''}
                aria-label="Channel output"
                onChange={(e) => update({ bus_id: e.target.value || null })}
              >
                <option value="">Master</option>
                {mixer.buses
                  .filter((b) => b.id !== channel.id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={channel.effects.compressor ?? false}
              onChange={(e) =>
                update({
                  effects: { ...channel.effects, compressor: e.target.checked },
                })
              }
            />
            Compressor
          </label>
          {track ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void commit([{ type: 'track.remove', track_id: track.id }])
              }
            >
              <Trash2 />
              Track
            </Button>
          ) : (
            channel.id !== 'master' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void commit([
                    {
                      type: 'mixer.set',
                      mixer: {
                        ...mixer,
                        buses: mixer.buses
                          .filter((b) => b.id !== channel.id)
                          .map((b) => ({
                            ...b,
                            bus_id:
                              b.bus_id === channel.id
                                ? channel.bus_id
                                : b.bus_id,
                          })),
                      },
                    },
                    ...project.document.tracks
                      .filter((t) => t.bus_id === channel.id)
                      .map((t) => ({
                        type: 'track.update' as const,
                        track_id: t.id,
                        bus_id: channel.bus_id,
                      })),
                  ])
                  setId('master')
                }}
              >
                <Trash2 />
                Bus
              </Button>
            )
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-8 gap-y-3">
          {effectFields.map(([key, label, min, max, step, fallback]) => (
            <NumberField
              key={key}
              label={label}
              min={min}
              max={max}
              step={step}
              value={Number(channel.effects[key] ?? fallback)}
              onChange={(v) =>
                update({ effects: { ...channel.effects, [key]: v } })
              }
            />
          ))}
        </div>
        {!track && (
          <div className="mt-5 border-t pt-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Automation · beats</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={(channel as Channel).automation?.length === 5}
                onClick={() => {
                  const target = channel as Channel
                  const parameter = (
                    [
                      'gain',
                      'lowpass',
                      'highpass',
                      'lowShelf',
                      'highShelf',
                    ] as const
                  ).find(
                    (p) => !target.automation?.some((l) => l.parameter === p),
                  )
                  if (parameter)
                    update({
                      automation: [
                        ...(target.automation ?? []),
                        {
                          parameter,
                          points: [
                            {
                              time: 0,
                              value:
                                parameter === 'gain'
                                  ? 1
                                  : parameter.includes('Shelf')
                                    ? 0
                                    : parameter === 'lowpass'
                                      ? 20000
                                      : 20,
                            },
                          ],
                        },
                      ],
                    })
                }}
              >
                <Plus />
                Lane
              </Button>
              <label className="text-sm">
                <input
                  type="checkbox"
                  checked={(channel as Channel).automation_bypassed}
                  onChange={(e) =>
                    update({ automation_bypassed: e.target.checked })
                  }
                />{' '}
                Bypass
              </label>
            </div>
            {(channel as Channel).automation?.map((lane, index) => (
              <div
                key={lane.parameter}
                className="mt-2 flex flex-wrap items-center gap-3"
              >
                <span className="w-20 text-sm">{lane.parameter}</span>
                {lane.points.map((point, i) => (
                  <div className="flex gap-1" key={i}>
                    <div className="w-28">
                      <NumberField
                        label="Beat"
                        value={point.time}
                        min={0}
                        step={0.25}
                        onChange={(time) =>
                          update({
                            automation: (channel as Channel).automation!.map(
                              (l, j) =>
                                j === index
                                  ? {
                                      ...l,
                                      points: l.points
                                        .map((p, k) =>
                                          k === i ? { ...p, time } : p,
                                        )
                                        .sort((a, b) => a.time - b.time),
                                    }
                                  : l,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="w-28">
                      <NumberField
                        label="Value"
                        value={point.value}
                        step={0.1}
                        onChange={(value) =>
                          update({
                            automation: (channel as Channel).automation!.map(
                              (l, j) =>
                                j === index
                                  ? {
                                      ...l,
                                      points: l.points.map((p, k) =>
                                        k === i ? { ...p, value } : p,
                                      ),
                                    }
                                  : l,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add automation point"
                  onClick={() =>
                    update({
                      automation: (channel as Channel).automation!.map(
                        (l, j) =>
                          j === index
                            ? {
                                ...l,
                                points: [
                                  ...l.points,
                                  {
                                    time: (l.points.at(-1)?.time ?? 0) + 4,
                                    value: l.points.at(-1)?.value ?? 1,
                                  },
                                ],
                              }
                            : l,
                      ),
                    })
                  }
                >
                  <Plus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove automation lane"
                  onClick={() =>
                    update({
                      automation: (channel as Channel).automation!.filter(
                        (_, j) => j !== index,
                      ),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
