import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./db";
import { handle } from "./api";
import { config } from "./config";
import { createProject, getProject, operation } from "./projects";
import { sha256Text, pythonJSON } from "./compatibility";
import { append } from "./producer";
const sandbox = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("./db", async (original) => ({
  ...(await original<typeof import("./db")>()),
  runtime: async () => sandbox.value,
}));
vi.mock("./audio-jobs", async (original) => ({
  ...(await original<typeof import("./audio-jobs")>()),
  audioReady: () => false,
  analysisReady: () => false,
}));
let db: Store, dir: string, media: string, examples: string;
beforeEach(() => {
  db = new Store(":memory:");
  dir = mkdtempSync(join(tmpdir(), "demotif-api-test-"));
  media = config.media;
  examples = config.examples;
  config.media = join(dir, "media");
  config.examples = join(dir, "examples");
  sandbox.value = {
    store: db,
    producerTasks: new Map(),
    audioTasks: new Map(),
  };
});
afterEach(() => {
  db.db.close();
  config.media = media;
  config.examples = examples;
  rmSync(dir, { recursive: true, force: true });
});
const call = (path: string, body?: unknown, headers?: HeadersInit) =>
  handle(
    new Request("http://localhost/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
it("returns unchanged project/API error contracts", async () => {
  const response = await call("/projects", { name: "Song" });
  expect(response.status).toBe(201);
  const p = await response.json();
  expect(p.document.tempo).toBe(120);
  const draft = await (await call(`/projects/${p.id}/drafts`, {})).json();
  expect(draft.draft_base_id).toBe(p.id);
  const edit = await call(`/projects/${draft.id}/commands`, {
    expected_version: 1,
    command: { type: "project.set_tempo", tempo: 99 },
  });
  expect(edit.status).toBe(200);
  const conflict = await call(`/projects/${draft.id}/commands`, {
    expected_version: 1,
    command: { type: "project.rename", name: "Oops" },
  });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).current_version).toBe(2);
  expect((await call("/projects/missing")).status).toBe(404);
  expect((await call("/projects", { name: "", tempo: NaN })).status).toBe(422);
  const list = await (await call("/projects")).json();
  expect(list).toHaveLength(1);
});
it("accepts browser writes when Next's internal host differs from the public host", async () => {
  const response = await call(
    "/projects",
    { name: "Local project" },
    { origin: "http://127.0.0.1:5173" },
  );
  expect(response.status).toBe(201);
  expect(db.all("SELECT * FROM projects")).toHaveLength(1);
});
it("serves authorized media ranges and denies other projects", async () => {
  const p = createProject(db, "P"),
    other = createProject(db, "Other"),
    form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3, 4, 5])], "sample.wav", {
      type: "audio/wav",
    }),
  );
  const upload = await handle(
    new Request(`http://localhost/api/projects/${p.id}/assets`, {
      method: "POST",
      body: form,
    }),
  );
  expect(upload.status).toBe(201);
  const asset = await upload.json();
  const response = await handle(
    new Request(
      `http://localhost/api/projects/${p.id}/assets/${asset.id}/content`,
      { headers: { Range: "bytes=1-3" } },
    ),
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 1-3/5");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4]);
  expect(
    (await call(`/projects/${other.id}/assets/${asset.id}/content`)).status,
  ).toBe(404);
  const invalid = await handle(
    new Request(
      `http://localhost/api/projects/${p.id}/assets/${asset.id}/content`,
      { headers: { Range: "bytes=9-" } },
    ),
  );
  expect(invalid.status).toBe(416);
});
it("replays durable SSE events and applies a proposal only once", async () => {
  const p = createProject(db, "P"),
    id = "run";
  db.run(
    "INSERT INTO producer_runs VALUES (?,?,?,?,?,?,?,?,?)",
    id,
    p.id,
    p.version,
    "Tempo",
    "complete",
    JSON.stringify([{ type: "project.set_tempo", tempo: 90 }]),
    null,
    0,
    new Date().toISOString(),
  );
  append(db, id, { type: "text", delta: "Proposed." });
  append(db, id, { type: "reply", text: "Proposed." });
  const first = await (
    await call(`/projects/${p.id}/producer/runs/${id}/apply`, {})
  ).json();
  expect(first.project.document.tempo).toBe(90);
  const again = await (
    await call(`/projects/${p.id}/producer/runs/${id}/apply`, {})
  ).json();
  expect(again.project.version).toBe(2);
  const events = await call(
    `/projects/${p.id}/producer/runs/${id}/events?after=1`,
  );
  const text = await events.text();
  expect(text).toContain("id: 2");
  expect(text).not.toContain("id: 1");
  expect(text).toContain("event: done");
  expect((await call("/projects/other/producer/runs/run/events")).status).toBe(
    404,
  );
});
it("recovers an old Python batch receipt without duplicating the edit", async () => {
  const p = createProject(db, "P"),
    request = {
      request_id: "legacy",
      expected_version: 1,
      commands: [{ type: "project.set_tempo", tempo: 90 }],
    };
  operation(db, p.id, 2, "Tempo", [], []);
  db.run("UPDATE projects SET version=2 WHERE id=?", p.id);
  db.run(
    "INSERT INTO command_receipts VALUES (?,?,?,?)",
    p.id,
    "legacy",
    sha256Text(pythonJSON(request)),
    2,
  );
  const response = await call(`/projects/${p.id}/commands/batch`, request);
  expect(response.status).toBe(200);
  expect((await response.json()).project.version).toBe(2);
});
it("loads multiple verified local example packs as independent drafts", async () => {
  const pack = join(config.examples, "test-song");
  mkdirSync(pack, { recursive: true });
  writeFileSync(
    join(pack, "manifest.json"),
    JSON.stringify({
      name: "Local example",
      document: { tempo: 130 },
      media: [],
    }),
  );
  const list = await (await call("/projects/examples")).json();
  expect(list.map((x: { id: string }) => x.id)).toEqual([
    "groove",
    "test-song",
  ]);
  const a = await (await call("/projects/examples/test-song", {})).json(),
    b = await (await call("/projects/examples/test-song", {})).json();
  expect(a.id).not.toBe(b.id);
  expect(a.is_draft).toBe(true);
  expect(a.has_unsaved_changes).toBe(false);
  expect(getProject(db, a.id).name).toBe("Local example");
});
