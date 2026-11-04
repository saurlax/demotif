import { pythonJSON, sha256Text } from "./compatibility";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  documentSchema,
  commandSchema,
  newId,
  sourceSchema,
  trackSchema,
  clipSchema,
  type Document,
  type Command,
} from "@/shared/schema";
import type { Store } from "./db";
import { cloneVocalRenders } from "./vocals/clone";
import { changes, restore, type Delta, type Json } from "./history";
import { conflict, invalid, locked, missing } from "./errors";
export interface ProjectRow {
  id: string;
  name: string;
  version: number;
  document: string;
  is_draft: number;
  draft_base_id: string | null;
  draft_base_version: number | null;
  draft_example_id: string | null;
  draft_checkpoint: string | null;
  created_at: string;
  updated_at: string;
}
export interface OperationRow {
  id: string;
  project_id: string;
  version: number;
  summary: string;
  forward: string;
  inverse: string;
  baseline: number;
  undo_of: string | null;
  created_at: string;
}
export interface AssetRow {
  id: string;
  project_id: string;
  kind: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  created_at: string;
}
export const now = () => new Date().toISOString();
export const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
export const digest = (v: unknown) =>
  createHash("sha256").update(stable(v)).digest("hex");
export function getProject(db: Store, id: string): ProjectRow {
  return (
    db.get<ProjectRow>("SELECT * FROM projects WHERE id=?", id) ??
    missing("Project not found")
  );
}
export function undoTarget(db: Store, p: ProjectRow) {
  return db.get<OperationRow>(
    `SELECT * FROM operations o WHERE project_id=? AND version<=? AND baseline=0 AND undo_of IS NULL AND NOT EXISTS (SELECT 1 FROM operations c WHERE c.undo_of=o.id AND c.version<=?) ORDER BY version DESC LIMIT 1`,
    p.id,
    p.version,
    p.version,
  );
}
export function readProject(db: Store, p: ProjectRow) {
  const document = documentSchema.parse(JSON.parse(p.document));
  return {
    ...p,
    document,
    is_draft: !!p.is_draft,
    can_undo: !!undoTarget(db, p),
    has_unsaved_changes:
      !!p.is_draft &&
      !isDeepStrictEqual(
        p.draft_checkpoint ? JSON.parse(p.draft_checkpoint) : null,
        { name: p.name, document: JSON.parse(p.document) },
      ),
    draft_checkpoint: undefined,
  };
}
export function operation(
  db: Store,
  id: string,
  version: number,
  summary: string,
  forward: Delta[] = [],
  inverse: Delta[] = [],
  baseline = false,
  undo_of: string | null = null,
) {
  const oid = newId();
  db.run(
    "INSERT INTO operations (id,project_id,version,summary,forward,inverse,baseline,undo_of,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    oid,
    id,
    version,
    summary.slice(0, 500),
    JSON.stringify(forward),
    JSON.stringify(inverse),
    baseline ? 1 : 0,
    undo_of,
    now(),
  );
  return db.get<OperationRow>("SELECT * FROM operations WHERE id=?", oid)!;
}
export function createProject(
  db: Store,
  name: string,
  document: unknown = {},
  draft = false,
  example: string | null = null,
  baseline = true,
) {
  const doc = documentSchema.parse(document),
    id = newId(),
    time = now();
  db.run(
    "INSERT INTO projects (id,name,version,document,is_draft,draft_example_id,draft_checkpoint,created_at,updated_at) VALUES (?,?,1,?,?,?,?,?,?)",
    id,
    z.string().min(1).max(200).parse(name),
    JSON.stringify(doc),
    draft ? 1 : 0,
    example,
    draft ? JSON.stringify({ name, document: doc }) : null,
    time,
    time,
  );
  if (baseline) operation(db, id, 1, "Project created", [], [], true);
  return getProject(db, id);
}
export function mediaRefs(document: Document) {
  return new Set(
    [
      ...document.sources.flatMap((s) => [
        s.asset_id,
        ...s.drum_samples.map((r) => r.asset_id),
      ]),
      ...document.tracks.flatMap((t) => t.clips.map((c) => c.asset_id)),
    ].filter((s): s is string => !!s),
  );
}
export function validateMedia(db: Store, id: string, d: Document) {
  for (const ref of mediaRefs(d))
    if (!db.get("SELECT id FROM assets WHERE id=? AND project_id=?", ref, id))
      invalid("Media asset is missing or belongs to another project");
}
export function applyEdit(document: Document, command: Command): string {
  const track = (id: string) =>
    document.tracks.find((t) => t.id === id) ?? missing("Track not found");
  const clip = (t: ReturnType<typeof track>, id: string) =>
    t.clips.find((c) => c.id === id) ?? missing("Clip not found");
  switch (command.type) {
    case "project.rename":
      return `Rename project to “${command.name}”`;
    case "project.set_tempo": {
      for (const t of document.tracks)
        for (const c of t.clips) {
          const s = document.sources.find((s) => s.id === c.source_id);
          if (s?.kind === "audio" || (!s && c.asset_id)) {
            c.source_duration ??= (c.length_beats * 60) / document.tempo;
            c.length_beats = (c.source_duration * command.tempo) / 60;
          }
        }
      document.tempo = command.tempo;
      return `Set tempo to ${command.tempo} BPM`;
    }
    case "project.set_time_signature":
      document.time_signature = command.time_signature;
      return `Set time signature to ${command.time_signature}`;
    case "track.add":
      document.tracks.push(
        trackSchema.parse({ ...command, id: command.id ?? newId() }),
      );
      return `Add track “${command.name}”`;
    case "track.remove": {
      const t = track(command.track_id);
      if (t.locked) locked();
      document.tracks.splice(document.tracks.indexOf(t), 1);
      return `Remove track “${t.name}”`;
    }
    case "track.set_lock":
      track(command.track_id).locked = command.locked;
      return command.locked ? "Lock track" : "Unlock track";
    case "clip.add": {
      const t = track(command.track_id);
      if (t.locked) locked();
      t.clips.push(
        clipSchema.parse({
          ...command,
          id: command.id ?? newId(),
          color: t.color,
        }),
      );
      return `Add clip “${command.name}”`;
    }
    case "clip.move": {
      const t = track(command.track_id),
        c = clip(t, command.clip_id);
      if (t.locked || c.locked) locked();
      c.start_beat = command.start_beat;
      return `Move clip “${c.name}”`;
    }
    case "clip.remove": {
      const t = track(command.track_id),
        c = clip(t, command.clip_id);
      if (t.locked || c.locked) locked();
      t.clips.splice(t.clips.indexOf(c), 1);
      return `Remove clip “${c.name}”`;
    }
    case "source.add":
      document.sources.push(structuredClone(command.source));
      return `Create source “${command.source.name}”`;
    case "source.update": {
      const index = document.sources.findIndex(
        (s) => s.id === command.source_id,
      );
      if (index < 0) missing("Source not found");
      if (
        document.tracks.some((t) =>
          t.clips.some(
            (c) => c.source_id === command.source_id && (t.locked || c.locked),
          ),
        )
      )
        locked();
      const { type, source_id, ...patch } = command;
      void type;
      void source_id;
      document.sources[index] = sourceSchema.parse({
        ...document.sources[index],
        ...patch,
      });
      return `Edit source “${document.sources[index].name}”`;
    }
    case "part.add":
      document.parts.push(structuredClone(command.part));
      return `Save clip “${command.part.name}”`;
    case "part.remove": {
      const i = document.parts.findIndex((p) => p.id === command.part_id);
      if (i < 0) missing("Clip not found");
      document.parts.splice(i, 1);
      return "Remove library clip";
    }
    case "track.update": {
      const t = track(command.track_id);
      if (t.locked) locked();
      const { type, track_id, ...patch } = command;
      void type;
      void track_id;
      Object.assign(t, patch);
      return `Edit track “${t.name}”`;
    }
    case "clip.update": {
      const t = track(command.track_id),
        c = clip(t, command.clip_id);
      if (t.locked || c.locked) locked();
      const { type, track_id, clip_id, target_track_id, ...patch } = command;
      void type;
      void track_id;
      void clip_id;
      Object.assign(c, patch);
      if (target_track_id && target_track_id !== t.id) {
        const dest = track(target_track_id);
        if (dest.locked) locked();
        t.clips.splice(t.clips.indexOf(c), 1);
        dest.clips.push(c);
      }
      return `Edit clip “${c.name}”`;
    }
    case "clip.split": {
      const t = track(command.track_id),
        c = clip(t, command.clip_id);
      if (t.locked || c.locked) locked();
      const delta = command.at_beat - c.start_beat;
      if (delta <= 0 || delta >= c.length_beats)
        invalid("Split must be inside the clip");
      const s = document.sources.find((s) => s.id === c.source_id),
        ratio =
          s?.kind === "audio" || (!s && c.asset_id) ? 60 / document.tempo : 1,
        window = c.source_duration ?? c.length_beats * ratio,
        cut = delta * ratio;
      if (cut >= window) invalid("Split exceeds source window");
      const envelope = c.envelope_duration ?? window;
      const right = {
        ...c,
        id: newId(),
        start_beat: command.at_beat,
        length_beats: c.length_beats - delta,
        offset: c.offset + cut,
        source_duration: window - cut,
        envelope_duration: envelope,
        envelope_offset: c.envelope_offset + cut,
      };
      c.length_beats = delta;
      c.source_duration = cut;
      c.envelope_duration = envelope;
      t.clips.splice(t.clips.indexOf(c) + 1, 0, right);
      return `Split clip “${c.name}”`;
    }
    case "mixer.set":
      if (
        document.tracks.some((t) => t.locked || t.clips.some((c) => c.locked))
      )
        locked();
      document.mixer = structuredClone(command.mixer);
      return "Edit mixer";
    case "project.set_sections":
      document.sections = structuredClone(command.sections);
      return "Edit sections";
  }
}
export function persist(
  db: Store,
  p: ProjectRow,
  expected: number,
  state: { name: string; document: Document },
  summary: string,
  undo?: OperationRow,
) {
  const updated = db.run(
    "UPDATE projects SET name=?,document=?,version=version+1,updated_at=? WHERE id=? AND version=?",
    state.name,
    JSON.stringify(state.document),
    now(),
    p.id,
    expected,
  );
  if (!updated.changes) conflict(getProject(db, p.id).version);
  const before = { name: p.name, document: JSON.parse(p.document) } as Json,
    after = state as Json;
  const op = operation(
    db,
    p.id,
    expected + 1,
    summary,
    changes(before, after),
    changes(after, before),
    false,
    undo?.id ?? null,
  );
  return {
    project: readProject(db, getProject(db, p.id)),
    revision: {
      project_id: p.id,
      version: op.version,
      summary: op.summary,
      created_at: op.created_at,
    },
  };
}
export function applyCommands(
  db: Store,
  id: string,
  input: unknown,
  batch = false,
) {
  return db.tx(() => {
    const request = z
      .object({
        expected_version: z.number().int().min(1),
        request_id: z.string().min(1).max(100).optional(),
        commands: z.array(commandSchema).min(1).max(512),
      })
      .parse(input);
    const p = getProject(db, id),
      fingerprint = digest(input);
    if (batch) {
      if (!request.request_id) invalid("Request ID is required");
      const receipt = db.get<{ fingerprint: string; version: number }>(
        "SELECT * FROM command_receipts WHERE project_id=? AND request_id=?",
        id,
        request.request_id,
      );
      if (receipt) {
        if (
          receipt.fingerprint !== fingerprint &&
          receipt.fingerprint !== sha256Text(pythonJSON(input))
        )
          invalid("Request ID already used for another edit");
        const op = db.get<OperationRow>(
          "SELECT * FROM operations WHERE project_id=? AND version=?",
          id,
          receipt.version,
        )!;
        return {
          project: readProject(db, p),
          revision: {
            project_id: id,
            version: op.version,
            summary: op.summary,
            created_at: op.created_at,
          },
        };
      }
    }
    if (p.version !== request.expected_version) conflict(p.version);
    let name = p.name;
    const document = documentSchema.parse(JSON.parse(p.document)),
      summaries = [];
    for (const c of request.commands) {
      summaries.push(applyEdit(document, c));
      if (c.type === "project.rename") name = c.name;
    }
    const validated = documentSchema.parse(document);
    validateMedia(db, id, validated);
    const result = persist(
      db,
      p,
      request.expected_version,
      { name, document: validated },
      summaries.join("; "),
    );
    if (batch)
      db.run(
        "INSERT INTO command_receipts VALUES (?,?,?,?)",
        id,
        request.request_id!,
        fingerprint,
        result.project.version,
      );
    return { ...result, ...(!batch ? { applied: request.commands[0] } : {}) };
  });
}
export function undo(db: Store, id: string, expected: number) {
  return db.tx(() => {
    const p = getProject(db, id);
    if (p.version !== expected) conflict(p.version);
    const target = undoTarget(db, p) ?? invalid("Nothing to undo");
    const state = restore(
      { name: p.name, document: JSON.parse(p.document) },
      JSON.parse(target.inverse),
    ) as { name: string; document: Document };
    state.document = documentSchema.parse(state.document);
    return persist(
      db,
      p,
      expected,
      state,
      `Undo change from version ${target.version}`,
      target,
    );
  });
}
export function cloneDocument(
  db: Store,
  from: ProjectRow,
  destination: string,
  allowWorkspace = false,
): Document {
  const document = documentSchema.parse(JSON.parse(from.document)),
    mapping = new Map<string, string>();
  for (const ref of mediaRefs(document)) {
    const asset =
      db.get<AssetRow>(
        `SELECT * FROM assets WHERE id=?${allowWorkspace ? "" : " AND project_id=?"}`,
        ...(allowWorkspace ? [ref] : [ref, from.id]),
      ) ?? invalid("Referenced audio is unavailable");
    const id = newId();
    mapping.set(ref, id);
    db.run(
      "INSERT INTO assets (id,project_id,kind,filename,content_type,size_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)",
      id,
      destination,
      asset.kind,
      asset.filename,
      asset.content_type,
      asset.size_bytes,
      asset.storage_key,
      now(),
    );
  }
  for (const s of document.sources) {
    if (s.asset_id) s.asset_id = mapping.get(s.asset_id)!;
    for (const row of s.drum_samples) row.asset_id = mapping.get(row.asset_id)!;
  }
  for (const t of document.tracks)
    for (const c of t.clips)
      if (c.asset_id) c.asset_id = mapping.get(c.asset_id)!;
  cloneVocalRenders(db, from.id, destination);
  return document;
}
export function copyProject(db: Store, id: string, draft = false) {
  return db.tx(() => {
    const p = getProject(db, id);
    if (draft && p.is_draft) invalid("This workspace is already a draft");
    const copied = createProject(
      db,
      draft ? p.name : `${p.name} copy`,
      {},
      draft,
    );
    const doc = cloneDocument(db, p, copied.id);
    db.run(
      "UPDATE projects SET document=?,draft_base_id=?,draft_base_version=?,draft_checkpoint=? WHERE id=?",
      JSON.stringify(doc),
      draft ? p.id : null,
      draft ? p.version : null,
      draft ? JSON.stringify({ name: p.name, document: doc }) : null,
      copied.id,
    );
    return readProject(db, getProject(db, copied.id));
  });
}
export function saveDraft(db: Store, id: string, input: unknown) {
  return db.tx(() => {
    const request = z
        .object({
          expected_version: z.number().int().min(1),
          save_as: z.boolean().default(false),
          name: z.string().min(1).max(200).optional(),
        })
        .parse(input),
      draft = getProject(db, id);
    if (!draft.is_draft) invalid("Open an editing draft before saving");
    if (draft.version !== request.expected_version) conflict(draft.version);
    if (!request.save_as && (draft.draft_example_id || !draft.draft_base_id))
      invalid("Examples can only be saved with Save as");
    const name = (
      request.save_as ? (request.name ?? draft.name) : draft.name
    ).trim();
    if (!name) invalid("A project name is required");
    let target: ProjectRow;
    if (request.save_as) {
      target = createProject(db, name);
      const document = cloneDocument(db, draft, target.id);
      db.run(
        "UPDATE projects SET document=? WHERE id=?",
        JSON.stringify(document),
        target.id,
      );
    } else {
      target = getProject(db, draft.draft_base_id!);
      if (target.is_draft || target.version !== draft.draft_base_version)
        conflict(target.version);
      if (!readProject(db, draft).has_unsaved_changes) {
        cloneVocalRenders(db, draft.id, target.id);
        return { project: readProject(db, draft), saved_project_id: target.id };
      }
      const document = cloneDocument(db, draft, target.id);
      persist(db, target, target.version, { name, document }, "Project saved");
      target = getProject(db, target.id);
    }
    const checkpoint = JSON.stringify({
      name,
      document: JSON.parse(draft.document),
    });
    const result = db.run(
      "UPDATE projects SET name=?,version=version+1,draft_base_id=?,draft_base_version=?,draft_example_id=NULL,draft_checkpoint=?,updated_at=? WHERE id=? AND version=?",
      name,
      target.id,
      target.version,
      checkpoint,
      now(),
      id,
      request.expected_version,
    );
    if (!result.changes) conflict(getProject(db, id).version);
    operation(db, id, draft.version + 1, "Draft saved", [], [], true);
    return {
      project: readProject(db, getProject(db, id)),
      saved_project_id: target.id,
    };
  });
}
