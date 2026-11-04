import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Store } from "./db";
import {
  applyCommands,
  copyProject,
  createProject,
  getProject,
  readProject,
  saveDraft,
  undo,
  type ProjectRow,
} from "./projects";
import { changes, restore, type Json } from "./history";
import { loadExample } from "./examples";
import { commandSchema, documentSchema, sourceSchema } from "@/shared/schema";
let db: Store;
beforeEach(() => {
  db = new Store(":memory:");
});
afterEach(() => db.db.close());
const edit = (p: ProjectRow, commands: unknown[], request_id?: string) =>
  applyCommands(
    db,
    p.id,
    {
      expected_version: p.version,
      commands,
      ...(request_id ? { request_id } : {}),
    },
    !!request_id,
  );
describe("typed commands and operation history", () => {
  it("validates tempo precision, finite values, meter and unknown nested settings", () => {
    for (const tempo of [19, 301, 120.15, NaN, Infinity])
      expect(() => documentSchema.parse({ tempo })).toThrow();
    expect(() => documentSchema.parse({ time_signature: "0/4" })).toThrow();
    expect(() => sourceSchema.parse({ synth: { surprise: true } })).toThrow();
    expect(
      commandSchema.parse({ type: "project.set_tempo", tempo: 132.1 }),
    ).toMatchObject({ tempo: 132.1 });
  });
  it("enforces versions and keeps history append-only across undo, new edits and restart", () => {
    const p = createProject(db, "Song");
    edit(p, [{ type: "project.rename", name: "Changed" }]);
    expect(() =>
      edit(p, [{ type: "project.set_tempo", tempo: 100 }]),
    ).toThrow();
    let current = getProject(db, p.id);
    undo(db, p.id, current.version);
    current = getProject(db, p.id);
    expect(current.name).toBe("Song");
    expect(current.version).toBe(3);
    expect(readProject(db, current).can_undo).toBe(false);
    edit(current, [{ type: "project.set_tempo", tempo: 95 }]);
    expect(
      db.all("SELECT * FROM operations WHERE project_id=?", p.id),
    ).toHaveLength(4);
    const first = getProject(db, p.id);
    undo(db, p.id, first.version);
    expect(JSON.parse(getProject(db, p.id).document).tempo).toBe(120);
  });
  it("deduplicates identical batches and rejects reuse with different content", () => {
    const p = createProject(db, "Song"),
      commands = [{ type: "track.add", id: "t", name: "Keys" }];
    const result = edit(p, commands, "request");
    expect(edit(p, commands, "request").project.version).toBe(
      result.project.version,
    );
    expect(() =>
      edit(p, [{ type: "project.rename", name: "Other" }], "request"),
    ).toThrow();
    expect(JSON.parse(getProject(db, p.id).document).tracks).toHaveLength(1);
  });
  it("rolls back the entire batch when the final state is invalid", () => {
    const p = createProject(db, "Song");
    expect(() =>
      edit(p, [
        { type: "track.add", id: "same", name: "A" },
        { type: "track.add", id: "same", name: "B" },
      ]),
    ).toThrow();
    expect(getProject(db, p.id).version).toBe(1);
    expect(JSON.parse(getProject(db, p.id).document).tracks).toEqual([]);
  });
  it("honors track and shared-source locks while allowing unlock and undo", () => {
    const example = loadExample(db, "groove"),
      p = getProject(db, example.id),
      doc = example.document,
      t = doc.tracks[0];
    edit(p, [{ type: "track.set_lock", track_id: t.id, locked: true }]);
    const locked = getProject(db, p.id);
    expect(() =>
      edit(locked, [
        { type: "source.update", source_id: doc.sources[0].id, name: "No" },
      ]),
    ).toThrow();
    expect(() =>
      edit(locked, [
        {
          type: "clip.move",
          track_id: t.id,
          clip_id: t.clips[0].id,
          start_beat: 2,
        },
      ]),
    ).toThrow();
    expect(() =>
      edit(locked, [{ type: "mixer.set", mixer: doc.mixer }]),
    ).toThrow();
    edit(locked, [{ type: "track.set_lock", track_id: t.id, locked: false }]);
    expect(
      readProject(db, getProject(db, p.id)).document.tracks[0].locked,
    ).toBe(false);
  });
  it("validates media ownership, source windows and mixer cycles", () => {
    const p = createProject(db, "Song");
    expect(() =>
      edit(p, [
        { type: "source.add", source: { kind: "audio", asset_id: "missing" } },
      ]),
    ).toThrow();
    expect(() =>
      documentSchema.parse({
        sources: [{ id: "s", duration: 4 }],
        parts: [{ source_id: "s", offset: 2, duration: 4 }],
      }),
    ).toThrow();
    expect(() =>
      documentSchema.parse({
        mixer: {
          buses: [
            { id: "a", bus_id: "b" },
            { id: "b", bus_id: "a" },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      sourceSchema.parse({
        notes: [{ id: "n", pitch: 60, start: 15, duration: 2 }],
      }),
    ).toThrow();
  });
  it("retains audio seconds during tempo changes and split envelope continuity", () => {
    const p = createProject(db, "Song");
    db.run(
      "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
      "media",
      p.id,
      "sample",
      "v.wav",
      "audio/wav",
      1,
      "v.wav",
      new Date().toISOString(),
    );
    edit(p, [
      {
        type: "source.add",
        source: { id: "audio", kind: "audio", asset_id: "media", duration: 10 },
      },
      { type: "track.add", id: "t", name: "Vocal" },
      {
        type: "clip.add",
        id: "c",
        track_id: "t",
        source_id: "audio",
        length_beats: 16,
        source_duration: 8,
      },
    ]);
    let current = getProject(db, p.id);
    edit(current, [{ type: "project.set_tempo", tempo: 180 }]);
    current = getProject(db, p.id);
    let d = documentSchema.parse(JSON.parse(current.document));
    expect(d.tracks[0].clips[0].length_beats).toBe(24);
    edit(current, [
      { type: "clip.split", track_id: "t", clip_id: "c", at_beat: 12 },
    ]);
    d = documentSchema.parse(JSON.parse(getProject(db, p.id).document));
    const [a, b] = d.tracks[0].clips;
    expect(a.source_duration).toBe(4);
    expect(b.offset).toBe(4);
    expect(b.envelope_offset).toBe(4);
    expect(a.envelope_duration).toBe(8);
    expect(b.envelope_duration).toBe(8);
  });
  it("round trips stable-ID entity deltas and ordinary automation arrays", () => {
    const a = {
        tracks: [
          { id: "a", gain: 1 },
          { id: "b", gain: 2 },
        ],
        points: [{ time: 0, value: 1 }],
      } as Json,
      b = {
        tracks: [
          { id: "b", gain: 0.5 },
          { id: "c", gain: 0.8 },
        ],
        points: [{ time: 2, value: 0.5 }],
      } as Json;
    expect(restore({ value: 1 }, [{ op: "set", path: ["value"] }])).toEqual({
      value: null,
    });
    expect(restore(a, changes(a, b))).toEqual(b);
    expect(restore(b, changes(b, a))).toEqual(a);
    expect(
      JSON.stringify(
        changes(
          {
            tracks: [{ id: "a", locked: false }],
            unrelated: "x".repeat(100000),
          },
          {
            tracks: [{ id: "a", locked: true }],
            unrelated: "x".repeat(100000),
          },
        ),
      ),
    ).not.toContain("xxx");
  });
});
describe("draft and save compatibility", () => {
  it("opens examples as unlisted clean drafts and requires Save as", () => {
    const first = loadExample(db, "groove"),
      second = loadExample(db, "groove");
    expect(first.id).not.toBe(second.id);
    expect(first.has_unsaved_changes).toBe(false);
    expect(db.all("SELECT * FROM projects WHERE is_draft=0")).toHaveLength(0);
    expect(() =>
      saveDraft(db, first.id, { expected_version: first.version }),
    ).toThrow();
    const saved = saveDraft(db, first.id, {
      expected_version: first.version,
      save_as: true,
      name: "My song",
    });
    expect(saved.project.has_unsaved_changes).toBe(false);
    expect(saved.project.draft_example_id).toBeNull();
    expect(db.all("SELECT * FROM projects WHERE is_draft=0")).toHaveLength(1);
  });
  it("isolates tabs and rejects stale base saves without losing the draft", () => {
    const p = createProject(db, "Saved"),
      a = copyProject(db, p.id, true),
      b = copyProject(db, p.id, true);
    edit(getProject(db, a.id), [{ type: "project.set_tempo", tempo: 100 }]);
    expect(JSON.parse(getProject(db, p.id).document).tempo).toBe(120);
    saveDraft(db, a.id, { expected_version: 2 });
    edit(getProject(db, b.id), [{ type: "project.set_tempo", tempo: 80 }]);
    expect(() => saveDraft(db, b.id, { expected_version: 2 })).toThrow();
    expect(readProject(db, getProject(db, b.id)).has_unsaved_changes).toBe(
      true,
    );
    expect(JSON.parse(getProject(db, p.id).document).tempo).toBe(100);
    const saved = saveDraft(db, b.id, {
      expected_version: 2,
      save_as: true,
      name: "Alternate",
    });
    expect(saved.project.has_unsaved_changes).toBe(false);
  });
  it("undo back to checkpoint clears dirty state", () => {
    const p = createProject(db, "Saved"),
      draft = copyProject(db, p.id, true);
    edit(getProject(db, draft.id), [{ type: "project.rename", name: "Dirty" }]);
    expect(readProject(db, getProject(db, draft.id)).has_unsaved_changes).toBe(
      true,
    );
    undo(db, draft.id, 2);
    expect(readProject(db, getProject(db, draft.id)).has_unsaved_changes).toBe(
      false,
    );
  });
  it("clones media ownership while preserving immutable storage keys", () => {
    const p = createProject(db, "Saved");
    db.run(
      "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
      "asset",
      p.id,
      "sample",
      "voice.wav",
      "audio/wav",
      4,
      "shared/voice.wav",
      new Date().toISOString(),
    );
    edit(p, [
      {
        type: "source.add",
        source: { id: "s", kind: "audio", asset_id: "asset", duration: 4 },
      },
    ]);
    const draft = copyProject(db, p.id, true),
      ref = draft.document.sources[0].asset_id!;
    expect(ref).not.toBe("asset");
    expect(
      db.get<{ storage_key: string }>(
        "SELECT storage_key FROM assets WHERE id=? AND project_id=?",
        ref,
        draft.id,
      )?.storage_key,
    ).toBe("shared/voice.wav");
    const saved = saveDraft(db, draft.id, {
      expected_version: 1,
      save_as: true,
      name: "Copy",
    });
    expect(saved.project.document.sources[0].asset_id).toBe(ref);
  });
});
