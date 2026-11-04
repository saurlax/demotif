import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  documentSchema,
  newId,
  sourceSchema,
  partSchema,
} from "@/shared/schema";
import { config } from "./config";
import { invalid, missing } from "./errors";
import { safePath, storeAsset } from "./media";
import { createProject, getProject, readProject } from "./projects";
import type { Store } from "./db";
const packSchema = z.object({
  name: z.string().min(1).max(200),
  document: documentSchema,
  media: z
    .array(
      z.object({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        filename: z.string(),
        file: z.string(),
      }),
    )
    .default([]),
});
export function readPack(id: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id === "groove")
    missing("Example not found");
  const directory = safePath(config.examples, id),
    manifest = safePath(directory, "manifest.json");
  if (!existsSync(manifest)) missing("Example not found");
  const pack = packSchema.parse(JSON.parse(readFileSync(manifest, "utf8")));
  if (new Set(pack.media.map((m) => m.id)).size !== pack.media.length)
    invalid("Duplicate example media");
  for (const m of pack.media) {
    const p = safePath(directory, m.file);
    if (
      !existsSync(p) ||
      !statSync(p).isFile() ||
      !realpathSync(p).startsWith(realpathSync(directory) + "/")
    )
      invalid("Missing example media");
  }
  return { directory, pack };
}
export function listExamples() {
  const result = [
    { id: "groove", name: "Pocket groove", tempo: 112, tracks: 3 },
  ];
  if (existsSync(config.examples))
    for (const entry of readdirSync(config.examples, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "groove") continue;
      try {
        const { pack } = readPack(entry.name);
        result.push({
          id: entry.name,
          name: pack.name,
          tempo: pack.document.tempo,
          tracks: pack.document.tracks.length,
        });
      } catch {
        /* Invalid local packs are not advertised. */
      }
    }
  return result;
}
export function loadExample(db: Store, id: string) {
  if (id === "groove") return groove(db);
  const { directory, pack } = readPack(id),
    payloads = pack.media.map((m) => ({
      media: m,
      data: readFileSync(safePath(directory, m.file)),
    }));
  for (const { media, data } of payloads)
    if (createHash("sha256").update(data).digest("hex") !== media.id)
      invalid("Example audio failed its integrity check");
  return db.tx(() => {
    const p = createProject(db, pack.name, {}, true, id),
      doc = structuredClone(pack.document),
      mapping = new Map<string, string>();
    for (const { media, data } of payloads) {
      const suffix = extname(media.file).toLowerCase(),
        types: Record<string, string> = {
          ".wav": "audio/wav",
          ".mp3": "audio/mpeg",
          ".ogg": "audio/ogg",
          ".flac": "audio/flac",
          ".m4a": "audio/mp4",
        };
      if (!types[suffix]) invalid("Unsupported example audio format");
      const asset = storeAsset(
        db,
        p.id,
        media.filename,
        types[suffix],
        data,
        "sample",
        `examples/${media.id}${suffix}`,
      );
      mapping.set(media.id, asset.id);
    }
    const resolve = (id: string) =>
      mapping.get(id) ?? invalid("Missing example media");
    for (const s of doc.sources) {
      if (s.asset_id) s.asset_id = resolve(s.asset_id);
      for (const r of s.drum_samples) r.asset_id = resolve(r.asset_id);
    }
    for (const t of doc.tracks)
      for (const c of t.clips) if (c.asset_id) c.asset_id = resolve(c.asset_id);
    const document = documentSchema.parse(doc);
    db.run(
      "UPDATE projects SET document=?,draft_checkpoint=? WHERE id=?",
      JSON.stringify(document),
      JSON.stringify({ name: p.name, document }),
      p.id,
    );
    return readProject(db, getProject(db, p.id));
  });
}
function groove(db: Store) {
  return db.tx(() => {
    const doc = documentSchema.parse({ tempo: 112 });
    for (const [name, kind, sound] of [
      ["Drums", "drums", "piano"],
      ["Bass", "notes", "electric-bass"],
      ["Keys", "notes", "electric-piano"],
    ] as const) {
      const s = sourceSchema.parse({ name, kind, sound, duration: 16 });
      const note = (
        pitch: number,
        start: number,
        duration: number,
        velocity: number,
      ) => s.notes.push({ id: newId(), pitch, start, duration, velocity });
      for (let bar = 0; bar < 4; bar++) {
        if (kind === "drums") {
          for (const [pitch, beat, velocity] of [
            [36, 0, 0.9],
            [36, 2, 0.8],
            [38, 1, 0.8],
            [38, 3, 0.85],
          ])
            note(pitch, bar * 4 + beat, 0.2, velocity);
          for (let i = 0; i < 8; i++)
            note(42, bar * 4 + i * 0.5, 0.2, i % 2 ? 0.5 : 0.65);
        } else if (name === "Bass") {
          for (const b of [0, 1.5, 2.5, 3.5])
            note(
              [36, 41, 33, 43][bar],
              bar * 4 + b,
              Math.min(0.7, 16 - bar * 4 - b),
              0.75,
            );
        } else
          for (const pitch of [
            [60, 63, 67],
            [65, 68, 72],
            [57, 60, 64],
            [67, 70, 74],
          ][bar])
            for (const b of [0, 1.5, 3]) note(pitch, bar * 4 + b, 0.8, 0.55);
      }
      doc.sources.push(s);
      doc.parts.push(partSchema.parse({ name, source_id: s.id, duration: 16 }));
      doc.tracks.push({
        id: newId(),
        name,
        kind: kind === "drums" ? "drums" : "instrument",
        color: null,
        muted: false,
        solo: false,
        locked: false,
        gain: 0.7,
        effects: doc.mixer.master.effects,
        bus_id: null,
        clips: [
          {
            id: newId(),
            name,
            kind: "midi",
            source_id: s.id,
            asset_id: null,
            start_beat: 0,
            length_beats: 16,
            offset: 0,
            source_duration: 16,
            gain: 1,
            fade_in: 0,
            fade_out: 0,
            envelope_offset: 0,
            envelope_duration: null,
            locked: false,
            color: null,
          },
        ],
      });
    }
    return readProject(
      db,
      createProject(
        db,
        "Pocket groove",
        documentSchema.parse(doc),
        true,
        "groove",
      ),
    );
  });
}
