import { z } from "zod";
import { SOUND_IDS } from "@/audio/soundDefinitions";

export const newId = () => crypto.randomUUID().replaceAll("-", "");
const id = z.string().min(1).max(200);
const uid = () => id.default(newId);
const positive = z.number().positive(),
  nonnegative = z.number().nonnegative();
const name = z.string().min(1).max(120);
const unit = z.number().min(0).max(1);
const trackKind = z.enum(["vocal", "instrument", "drums", "audio", "midi"]);
const clipKind = z.enum(["audio", "midi", "generated"]);
export const noteSchema = z.strictObject({
  id: uid(),
  pitch: z.number().int().min(0).max(127),
  start: nonnegative.default(0),
  duration: positive.default(1),
  velocity: z.number().positive().max(1).default(0.8),
});
export const effectsSchema = z.strictObject({
  highpass: z.number().min(20).max(20000).default(20),
  lowpass: z.number().min(20).max(20000).default(20000),
  drive: unit.default(0),
  reverb: unit.default(0),
  delay: unit.default(0),
  sidechain: unit.default(0),
  pan: z.number().min(-1).max(1).default(0),
  compressor: z.boolean().default(false),
  threshold: z.number().min(-100).max(0).default(-24),
  ratio: z.number().min(1).max(20).default(4),
  compAttack: unit.default(0.003),
  compRelease: unit.default(0.25),
  chorus: unit.default(0),
  phaser: unit.default(0),
  tremolo: unit.default(0),
  autopan: unit.default(0),
  bitcrusher: unit.default(0),
  lowShelf: z.number().min(-12).max(12).default(0),
  highShelf: z.number().min(-12).max(12).default(0),
  softClip: unit.default(0),
  width: z.number().min(0).max(2).default(1),
  air: unit.default(0),
  multiband: unit.default(0),
});
export const oscillatorSchema = z.strictObject({
  wave: z.enum(["saw", "sine", "square", "triangle"]).default("saw"),
  level: unit.default(0.5),
  transpose: z.number().min(-48).max(48).default(0),
  voices: z.number().int().min(1).max(16).default(1),
  detune: z.number().min(0).max(100).default(0),
  spread: unit.default(0),
  pan: z.number().min(-1).max(1).default(0),
  bypassFilter: z.boolean().default(false),
});
export const synthSchema = z.strictObject({
  oscillators: z.array(oscillatorSchema).max(3).nullable().default(null),
  attack: z.number().min(0).max(5).default(0.01),
  decay: z.number().min(0.01).max(5).default(0.2),
  sustain: unit.default(0.7),
  release: z.number().min(0).max(8).default(0.3),
  cutoff: z.number().min(20).max(20000).default(12000),
  detune: z.number().min(-100).max(100).default(0),
  resonance: z.number().min(0).max(30).default(0),
  filterDrive: z.number().min(0).max(24).default(0),
  keytrack: unit.default(0),
});
export const samplerSchema = z
  .strictObject({
    rootNote: z.number().int().min(0).max(127).default(60),
    loopStart: nonnegative.nullable().default(null),
    loopEnd: positive.nullable().default(null),
    oneShot: z.boolean().default(false),
  })
  .refine(
    (s) => s.loopEnd == null || s.loopEnd > (s.loopStart ?? 0),
    "Sampler loop end must follow its start",
  );
const drumSample = z.strictObject({
  pitch: z.number().int().min(0).max(127),
  name: z.string().max(120),
  asset_id: id,
  gain: z.number().min(0).max(2).default(1),
});
const sound = z.enum(SOUND_IDS);
const drumKit = z.enum(["studio", "808", "909", "lofi"]);
const sourceObject = z.strictObject({
  id: uid(),
  name: name.default("Clip"),
  kind: z.enum(["notes", "drums", "audio"]).default("notes"),
  duration: positive.default(16),
  asset_id: id.nullable().default(null),
  notes: z.array(noteSchema).max(10000).default([]),
  sound: sound.default("piano"),
  drum_kit: drumKit.default("studio"),
  synth: synthSchema.default(() => synthSchema.parse({})),
  sampler: samplerSchema.nullable().default(null),
  drum_samples: z.array(drumSample).max(32).default([]),
});
export const sourceSchema = sourceObject.superRefine((s, ctx) => {
  if (s.kind === "audio" && (!s.asset_id || s.notes.length))
    ctx.addIssue({
      code: "custom",
      message: "Audio sources need media and cannot contain notes",
    });
  if (
    s.kind !== "audio" &&
    s.notes.some((n) => n.start + n.duration > s.duration + 1e-6)
  )
    ctx.addIssue({ code: "custom", message: "Notes exceed source duration" });
  if (
    new Set(s.notes.map((n) => n.id)).size !== s.notes.length ||
    new Set(s.drum_samples.map((r) => r.pitch)).size !== s.drum_samples.length
  )
    ctx.addIssue({
      code: "custom",
      message: "Duplicate notes or drum pitches",
    });
});
export const partSchema = z.strictObject({
  id: uid(),
  name: name.default("Clip"),
  source_id: id,
  offset: nonnegative.default(0),
  duration: positive.default(16),
});
export const clipSchema = z.object({
  id: uid(),
  name: z.string().default("Clip"),
  kind: clipKind.default("audio"),
  start_beat: nonnegative.default(0),
  length_beats: positive.default(4),
  asset_id: id.nullable().default(null),
  source_id: id.nullable().default(null),
  offset: nonnegative.default(0),
  source_duration: positive.nullable().default(null),
  gain: z.number().min(0).max(2).default(1),
  fade_in: nonnegative.default(0),
  fade_out: nonnegative.default(0),
  envelope_offset: nonnegative.default(0),
  envelope_duration: positive.nullable().default(null),
  locked: z.boolean().default(false),
  color: z.string().nullable().default(null),
});
const automation = z
  .strictObject({
    parameter: z.enum(["gain", "lowpass", "highpass", "lowShelf", "highShelf"]),
    points: z
      .array(z.strictObject({ time: nonnegative, value: z.number() }))
      .max(10000)
      .default([]),
  })
  .superRefine((a, ctx) => {
    const [lo, hi] = {
      gain: [0, 2],
      lowpass: [20, 20000],
      highpass: [20, 20000],
      lowShelf: [-12, 12],
      highShelf: [-12, 12],
    }[a.parameter];
    if (
      a.points.some(
        (p, i) =>
          p.value < lo ||
          p.value > hi ||
          (i > 0 && p.time < a.points[i - 1].time),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid automation points" });
  });
const effects = () => effectsSchema.parse({});
export const channelSchema = z.strictObject({
  id: uid(),
  name: name.default("Bus"),
  gain: z.number().min(0).max(2).default(1),
  effects: effectsSchema.default(effects),
  bus_id: id.nullable().default(null),
  automation: z.array(automation).max(5).default([]),
  automation_bypassed: z.boolean().default(false),
});
export const mixerSchema = z.strictObject({
  master: channelSchema.default(() =>
    channelSchema.parse({ id: "master", name: "Master" }),
  ),
  buses: z.array(channelSchema).max(64).default([]),
});
export const sectionSchema = z.strictObject({
  id: uid(),
  name,
  start: nonnegative,
  duration: positive,
  color: z.string().default("#a1a1aa"),
});
export const trackSchema = z.object({
  id: uid(),
  name: z.string().default("Track"),
  kind: trackKind.default("instrument"),
  color: z.string().nullable().default(null),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  locked: z.boolean().default(false),
  gain: z.number().min(0).max(2).default(0.7),
  effects: effectsSchema.default(effects),
  bus_id: id.nullable().default(null),
  clips: z.array(clipSchema).default([]),
});
export const timeSignature = z
  .string()
  .regex(/^(?:[1-9]|[12][0-9]|3[0-2])\/(?:1|2|4|8|16)$/);
export const tempoSchema = z
  .number()
  .min(20)
  .max(300)
  .refine(
    (t) => Math.abs(t * 10 - Math.round(t * 10)) < 1e-8,
    "Tempo supports one decimal place",
  );
export const documentSchema = z
  .object({
    tempo: tempoSchema.default(120),
    time_signature: timeSignature.default("4/4"),
    key: z.string().nullable().default(null),
    tracks: z.array(trackSchema).default([]),
    sources: z.array(sourceSchema).default([]),
    parts: z.array(partSchema).default([]),
    mixer: mixerSchema.default(() => mixerSchema.parse({})),
    sections: z.array(sectionSchema).default([]),
  })
  .superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const clips = d.tracks.flatMap((t) => t.clips);
    for (const list of [
      d.tracks,
      d.sources,
      d.parts,
      d.sections,
      d.mixer.buses,
      clips,
    ])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        fail("Duplicate entity IDs");
    const sources = new Map(d.sources.map((s) => [s.id, s]));
    for (const item of [...d.parts, ...clips.filter((c) => c.source_id)]) {
      const s = sources.get(item.source_id!);
      if (!s) {
        fail("Source does not exist");
        continue;
      }
      const duration =
        "duration" in item
          ? item.duration
          : (item.source_duration ??
            item.length_beats * (s.kind === "audio" ? 60 / d.tempo : 1));
      if (item.offset + duration > s.duration + 1e-6)
        fail("Source window exceeds source duration");
    }
    const buses = new Map(d.mixer.buses.map((b) => [b.id, b]));
    if (buses.has("master") || d.mixer.master.bus_id)
      fail("Invalid master routing");
    for (const c of [...d.tracks, ...d.mixer.buses]) {
      const seen = new Set([c.id]);
      let target = c.bus_id;
      while (target) {
        if (!buses.has(target) || seen.has(target)) {
          fail("Invalid or cyclic bus route");
          break;
        }
        seen.add(target);
        target = buses.get(target)!.bus_id;
      }
    }
  });
const optionalNullable = id.nullable().optional();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project.rename"),
    name: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal("project.set_tempo"), tempo: tempoSchema }),
  z.object({
    type: z.literal("project.set_time_signature"),
    time_signature: timeSignature,
  }),
  z.object({
    type: z.literal("track.add"),
    id: optionalNullable,
    name,
    kind: trackKind.default("instrument"),
    color: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal("track.remove"), track_id: id }),
  z.object({
    type: z.literal("track.set_lock"),
    track_id: id,
    locked: z.boolean(),
  }),
  z.object({
    type: z.literal("clip.add"),
    id: optionalNullable,
    track_id: id,
    name: z.string().max(120).default("Clip"),
    kind: clipKind.default("audio"),
    source_id: optionalNullable,
    asset_id: optionalNullable,
    offset: nonnegative.default(0),
    source_duration: positive.nullable().default(null),
    start_beat: nonnegative.default(0),
    length_beats: positive.default(4),
  }),
  z.object({
    type: z.literal("clip.move"),
    track_id: id,
    clip_id: id,
    start_beat: nonnegative,
  }),
  z.object({ type: z.literal("clip.remove"), track_id: id, clip_id: id }),
  z.object({ type: z.literal("source.add"), source: sourceSchema }),
  z.object({
    type: z.literal("source.update"),
    source_id: id,
    name: name.optional(),
    notes: z.array(noteSchema).max(10000).optional(),
    duration: positive.optional(),
    sound: sound.optional(),
    drum_kit: drumKit.optional(),
    synth: synthSchema.optional(),
    sampler: samplerSchema.nullable().optional(),
    drum_samples: z.array(drumSample).max(32).optional(),
  }),
  z.object({ type: z.literal("part.add"), part: partSchema }),
  z.object({ type: z.literal("part.remove"), part_id: id }),
  z.object({
    type: z.literal("track.update"),
    track_id: id,
    name: name.optional(),
    color: z.string().nullable().optional(),
    muted: z.boolean().optional(),
    solo: z.boolean().optional(),
    gain: z.number().min(0).max(2).optional(),
    bus_id: optionalNullable,
    effects: effectsSchema.optional(),
  }),
  z.object({
    type: z.literal("clip.update"),
    track_id: id,
    clip_id: id,
    target_track_id: id.optional(),
    name: name.optional(),
    start_beat: nonnegative.optional(),
    length_beats: positive.optional(),
    offset: nonnegative.optional(),
    source_duration: positive.optional(),
    source_id: optionalNullable,
    gain: z.number().min(0).max(2).optional(),
    fade_in: nonnegative.optional(),
    fade_out: nonnegative.optional(),
    envelope_offset: nonnegative.optional(),
    envelope_duration: positive.optional(),
  }),
  z.object({
    type: z.literal("clip.split"),
    track_id: id,
    clip_id: id,
    at_beat: nonnegative,
  }),
  z.object({ type: z.literal("mixer.set"), mixer: mixerSchema }),
  z.object({
    type: z.literal("project.set_sections"),
    sections: z.array(sectionSchema),
  }),
]);
export type Document = z.infer<typeof documentSchema>;
export type Command = z.infer<typeof commandSchema>;
