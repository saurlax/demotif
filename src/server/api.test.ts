import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./db";
import { handle } from "./api";
import { config } from "./config";
import { createProject, getProject, operation } from "./projects";
import { sha256Text, pythonJSON } from "./compatibility";
import { binaries, type S3BinaryStore } from './storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
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
it('proxies before opening a local runtime and never falls back after upstream failure', async () => {
  const old = config.upstream, local = sandbox.value; config.upstream = 'https://backend.test/api'; sandbox.value = undefined;
  const send = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('unreachable'));
  try { expect((await call('/projects')).status).toBe(502); expect(db.all('SELECT * FROM projects')).toHaveLength(0); }
  finally { config.upstream = old; sandbox.value = local; send.mockRestore(); }
});
async function uploadDirectFixture(project:string,kind='recording',version?:number) {
  const bytes=Buffer.from([1,2,3,4,5]),md5=createHash('md5').update(bytes).digest('hex');
  const response=await call(`/projects/${project}/uploads`,{filename:'sample.wav',content_type:'audio/wav',size_bytes:bytes.length,md5,kind,project_version:version});
  expect(response.status).toBe(201);const reserved=await response.json();
  const store=binaries() as S3BinaryStore;
  await store.client.send(new PutObjectCommand({Bucket:store.bucket,Key:store.prefix+'incoming/'+reserved.id,Body:bytes,ContentType:'audio/wav'}));
  const completed=await call(`/projects/${project}/uploads/${reserved.id}/complete`,{});
  expect(completed.status).toBe(201);return {asset:await completed.json(),reservation:reserved.id};
}
it('publishes a direct export at its captured version without saving the draft',async()=>{
  const p=createProject(db,'Export');
  await call(`/projects/${p.id}/commands`,{expected_version:1,command:{type:'project.set_tempo',tempo:99}});
  await uploadDirectFixture(p.id,'export',1);
  expect(db.get<{project_version:number}>('SELECT project_version FROM audio_exports')!.project_version).toBe(1);
  expect(getProject(db,p.id).version).toBe(2);
});
it('issues exact-object sessions, denies foreign access and makes completion idempotent',async()=>{
  const p=createProject(db,'P'),other=createProject(db,'Other');
  const {asset,reservation}=await uploadDirectFixture(p.id);
  const session=await (await call(`/projects/${p.id}/assets/${asset.id}/content`)).json();
  expect(session.key).toContain('uploads/'+asset.id+'/');
  expect(session.credentials.accessKeyId).toBe('temporary-id');
  expect((await call(`/projects/${other.id}/assets/${asset.id}/content`)).status).toBe(404);
  expect((await call(`/projects/${other.id}/uploads/${reservation}/complete`,{})).status).toBe(404);
  await call(`/projects/${p.id}/uploads/${reservation}/complete`,{});
  expect(db.all('SELECT * FROM assets')).toHaveLength(1);
  expect((await call(`/projects/${p.id}/assets`,{})).status).toBe(410);
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

it('exposes optional voices and validates vocal version, installation and ownership through the API', async () => {
  const p = createProject(db, 'Vocal API')
  const { applyCommands } = await import('./projects')
  applyCommands(db, p.id, { expected_version: 1, commands: [{ type: 'source.add', source: {
    id: 'singer', kind: 'vocal', duration: 4, notes: [{ id: 'n', pitch: 60, start: 0, duration: 1 }],
    vocal: { voice_id: 'not-installed', language: 'zh', syllables: { n: { kind: 'syllable', lyric: '你' } } },
  } }] })
  expect((await call('/vocal-voices')).status).toBe(200)
  const missing = await (await call(`/projects/${p.id}/vocal-sources/singer/render`)).json()
  expect(missing.status).toBe('missing')
  expect((await call(`/projects/${p.id}/vocal-sources/singer/render?expected_version=1`)).status).toBe(409)
  expect((await call(`/projects/${p.id}/vocal-renders`, { source_id: 'singer', expected_version: 1 })).status).toBe(409)
  const unavailable = await call(`/projects/${p.id}/vocal-renders`, { source_id: 'singer', expected_version: 2 })
  expect(unavailable.status).toBe(503)
  expect((await unavailable.json()).code).toBe('voice_unavailable')
  expect((await call(`/projects/${p.id}/vocal-renders/other-request`)).status).toBe(404)
})
