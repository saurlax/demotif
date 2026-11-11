import { randomUUID } from '@/shared/id'
import { z } from "zod";
import { SOUND_IDS } from "@/audio/soundDefinitions";

export const newId = () => randomUUID().replaceAll("-", "");
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
  sample: z.strictObject({offset:nonnegative,duration:positive,rootNote:z.number().int().min(0).max(127)}).optional(),
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
const vocalPoint = z.strictObject({ beat: nonnegative, value: z.number() });
const syllable = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("syllable"),
    lyric: z.string().default(""),
    mode: z.enum(["single", "multiple"]).optional(),
    pronunciation: z.string().optional(),
    phonemes: z.array(z.strictObject({
      symbol: z.string().min(1), duration_beats: positive.optional(),
    })).optional(),
  }),
  z.strictObject({ kind: z.literal("continue") }),
]);
export const vocalSchema = z.strictObject({
  voice_id: id,
  language: z.string().min(1),
  syllables: z.record(id, syllable).default({}),
  pitch: z.array(vocalPoint).default([]), // source-local beats, cents from score pitch
  volume: z.array(vocalPoint.extend({ value: z.number().min(0).max(2) })).default([]),
  vibrato: z.record(id, z.strictObject({
    rate_hz: positive, depth_cents: nonnegative,
    onset: unit.default(0.5),
  })).default({}),
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
export const recordingCueSchema = z.strictObject({
  note_id: id, text: z.string(), start: nonnegative, end: positive,
  timing: z.enum(["score", "authored", "estimated"]),
}).refine((c) => c.end > c.start, "Cue end must follow its start");
export const referenceRecordingSchema = z.strictObject({
  source_id: id, project_id: id, project_version: z.number().int().positive(),
  tempo: tempoSchema, time_signature: timeSignature,
  source_origin_beat: z.number(), sample_rate: z.number().int().positive(),
  capture_start_frame: z.number().int().nonnegative(), interrupted: z.boolean(),
  cues: z.array(recordingCueSchema),
});
const sourceObject = z.strictObject({
  id: uid(),
  name: name.default("Clip"),
  kind: z.enum(["notes", "drums", "audio", "vocal"]).default("notes"),
  duration: positive.default(16),
  asset_id: id.nullable().default(null),
  notes: z.array(noteSchema).max(10000).default([]),
  sound: sound.default("piano"),
  drum_kit: drumKit.default("studio"),
  synth: synthSchema.default(() => synthSchema.parse({})),
  sampler: samplerSchema.nullable().default(null),
  drum_samples: z.array(drumSample).max(32).default([]),
  vocal: vocalSchema.optional(),
  reference_recording: referenceRecordingSchema.optional(),
});
export const sourceSchema = sourceObject.superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if(s.notes.some(n=>n.sample)&&(!["notes","drums"].includes(s.kind)||!s.sampler||!s.asset_id||s.drum_samples.length>0))fail("Sample regions require a note or drum sampler source with audio and no competing drum sample bank");
  if (s.reference_recording && s.kind !== "audio") fail("Reference recordings require an audio source");
  if (s.kind === "vocal") {
    if (!s.vocal) fail("Vocal sources need a voice and language");
    if (s.asset_id) fail("Vocal sources use editable scores, not an audio asset");
    const notes = [...s.notes].sort((a, b) => a.start - b.start);
    const ids = new Set(notes.map((n) => n.id));
    for (let i = 1; i < notes.length; i++)
      if (notes[i].start < notes[i - 1].start + notes[i - 1].duration - 1e-6)
        fail(`Vocal notes overlap: ${notes[i - 1].id}, ${notes[i].id}`);
    if (s.vocal) {
      const vocal = s.vocal;
      for (const key of [...Object.keys(vocal.syllables), ...Object.keys(vocal.vibrato)])
        if (!ids.has(key)) fail(`Vocal assignment refers to missing note: ${key}`);
      for (let i = 0; i < notes.length; i++) {
        const assignment = vocal.syllables[notes[i].id];
        if (assignment?.kind === "continue") {
          const previous = notes[i - 1];
          const parent = previous && vocal.syllables[previous.id];
          if (!previous || !parent || (parent.kind === "syllable" && !parent.lyric.trim()) ||
              Math.abs(previous.start + previous.duration - notes[i].start) > 1e-6)
            fail(`Continuation needs an adjacent preceding syllable: ${notes[i].id}`);
        }
        if (assignment?.kind === "syllable" && assignment.phonemes) {
          let duration = notes[i].duration;
          for (let j = i + 1; j < notes.length && vocal.syllables[notes[j].id]?.kind === "continue"; j++)
            duration += notes[j].duration;
          if (assignment.phonemes.reduce((sum, p) => sum + (p.duration_beats ?? 0), 0) > duration + 1e-6)
            fail(`Phoneme durations exceed syllable group: ${notes[i].id}`);
        }
      }
      for (const [name, points] of [["pitch", vocal.pitch], ["volume", vocal.volume]] as const)
        for (let i = 0; i < points.length; i++)
          if (points[i].beat > s.duration || (i > 0 && points[i].beat <= points[i - 1].beat))
            fail(`Vocal ${name} points must be ordered within source duration`);
    }
  } else if (s.vocal) fail("Vocal metadata requires a vocal source");
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
const scoreRange = { start: nonnegative, duration: positive };
const scoreMeter = z.string().regex(/^\d+\/\d+$/);
export const abcScoreSchema = z.strictObject({
  abc: z.string().min(1),
  bpm: positive.int(),
  meter: scoreMeter,
  unit_length: z.string().regex(/^(?:1|1\/\d+)$/),
  duration_beats: positive,
  bars: z.array(z.strictObject({ ...scoreRange, meter: scoreMeter })).min(1),
  keys: z.array(z.strictObject({ start: nonnegative, key: z.string().min(1) })).min(1),
  chords: z.array(z.strictObject({ start: nonnegative, symbol: z.string().min(1) })),
  sections: z.array(z.strictObject({ ...scoreRange, name: z.string().min(1) })),
}).refine(score => {
  const withinScore = [...score.bars, ...score.sections].every(event =>
    event.start + event.duration <= score.duration_beats + 1e-6,
  );
  const timed = [score.keys, score.chords].every(events =>
    events.every((event, index) => event.start < score.duration_beats && (!index || events[index - 1].start <= event.start)),
  );
  return withinScore && timed;
}, 'Invalid ABC event timing');
const abcImportSchema = z.strictObject({
  id: uid(),
  name,
  start_beat: nonnegative,
  lyrics: z.string(),
  score: abcScoreSchema,
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
    abc_imports: z.array(abcImportSchema).optional(),
  })
  .superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const clips = d.tracks.flatMap((t) => t.clips);
    for (const list of [
      d.tracks,
      d.sources,
      d.parts,
      d.sections,
      d.abc_imports ?? [],
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
  z.object({ type: z.literal("project.set_key"), key: name.nullable() }),
  z.object({
    type: z.literal("project.add_abc_score"),
    imported: abcImportSchema,
    material: z.strictObject({ tracks: z.array(trackSchema), sources: z.array(sourceSchema) }).optional(),
  }),
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
    vocal: vocalSchema.optional(),
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

export const audioContextSchema = z.object({
  expected_version: z.number().int().positive(),
  track_id: z.string().nullable().default(null),
  clip_id: z.string().nullable().default(null),
  start_beat: z.number().nonnegative(),
  offset_seconds: z.number().nonnegative().default(0),
  duration_seconds: z.number().positive().optional(),
  source_id: z.string().optional(),
  note_ids: z.array(z.string()).optional(),
});
export type AudioContext = z.infer<typeof audioContextSchema>;
export const clientRenderSchema=z.object({request_id:z.string().min(1).max(100),context:audioContextSchema,name:z.string().min(1).max(80),reference_only:z.boolean().optional(),sound:sound.optional()});
export type ClientRender=z.infer<typeof clientRenderSchema>;
export const audioCapabilitySchema = z.object({
  id: z.string(), name: z.string(), provider: z.enum(['elevenlabs', 'local']),
  category: z.enum(['music', 'speech', 'sound', 'singing', 'transcribe', 'separate', 'voice_conversion', 'isolate', 'recognize', 'align']),
  ready: z.boolean(), reason: z.string().optional(),
  voices: z.array(z.string()).default([]),
  voice_names: z.record(z.string(),z.string()).optional(),
  format: z.enum(['mp3', 'pcm', 'wav']).default('mp3'),
  sample_rate: z.number().optional(), channels: z.number().optional(),
  loop: z.boolean().default(false),
  min_seconds: z.number(), max_seconds: z.number(), reference_audio: z.boolean().default(false),
});
export type AudioCapability = z.infer<typeof audioCapabilitySchema>;
export const producerTargetSchema = z.object({
  track_id: z.string().optional(), clip_id: z.string().optional(),
  source_id: z.string().optional(), note_ids: z.array(z.string()).optional(),
  start_beat: z.number().nonnegative().optional(),
});
export type ProducerTarget = z.infer<typeof producerTargetSchema>;
