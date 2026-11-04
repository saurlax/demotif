import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { Store } from "./db";
import { createProject, getProject } from "./projects";
import {
  createProducerTools,
  produce,
  startProducer,
  requireRun,
  append,
} from "./producer";
import { documentSchema } from "@/shared/schema";
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
let db: Store, tasks: Map<string, AbortController>;
beforeEach(() => {
  db = new Store(":memory:");
  tasks = new Map();
  sandbox.value = { store: db, producerTasks: tasks, audioTasks: new Map() };
});
afterEach(() => db.db.close());
function model(chunks: LanguageModelV4StreamPart[][]) {
  return new MockLanguageModelV4({
    doStream: chunks.map((parts) => ({
      stream: new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(p);
          c.close();
        },
      }),
    })),
  });
}
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage,
});
it("stages edits without changing the project and rejects a locked proposal atomically", () => {
  const events: unknown[] = [],
    session = createProducerTools(
      documentSchema.parse({ tracks: [{ id: "t", locked: true }] }),
      (e) => events.push(e),
    );
  expect(() =>
    session.propose([
      { type: "project.set_tempo", tempo: 90 },
      { type: "track.update", track_id: "t", gain: 1 },
    ]),
  ).toThrow();
  expect(session.commands).toEqual([]);
  expect(session.getDocument().tempo).toBe(120);
  session.propose([{ type: "project.set_tempo", tempo: 95 }]);
  expect(session.commands).toHaveLength(1);
  expect(session.getDocument().tempo).toBe(95);
});
it("streams visible text and stages typed tool calls through the real AI SDK loop", async () => {
  const p = createProject(db, "Song"),
    events: Record<string, unknown>[] = [];
  const mock = model([
    [
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "propose_edits",
        input: JSON.stringify({
          edits: [{ type: "project.set_tempo", tempo: 90 }],
        }),
      },
      finish("tool-calls"),
    ],
    [
      { type: "text-start", id: "reply" },
      { type: "text-delta", id: "reply", delta: "Proposed tempo." },
      { type: "text-end", id: "reply" },
      finish("stop"),
    ],
  ]);
  const result = await produce(
    db,
    p,
    "Make it slower",
    new AbortController().signal,
    (e) => events.push(e),
    mock,
  );
  expect(result.commands).toEqual([{ type: "project.set_tempo", tempo: 90 }]);
  expect(events).toContainEqual({ type: "reply", text: "Proposed tempo." });
  expect(JSON.parse(getProject(db, p.id).document).tempo).toBe(120);
  expect(mock.doStreamCalls).toHaveLength(2);
});
it("persists completion, recovers identical starts and rejects conflicting run IDs", async () => {
  const p = createProject(db, "Song"),
    mock = model([
      [
        { type: "text-start", id: "r" },
        { type: "text-delta", id: "r", delta: "Hello" },
        { type: "text-end", id: "r" },
        finish("stop"),
      ],
    ]);
  const request = { id: "run", text: "Hello", expected_version: 1 };
  await startProducer(db, p.id, request, mock);
  await vi.waitFor(() =>
    expect(requireRun(db, p.id, "run").status).toBe("complete"),
  );
  expect(await startProducer(db, p.id, request, mock)).toEqual({
    id: "run",
    status: "complete",
  });
  expect(mock.doStreamCalls).toHaveLength(1);
  await expect(
    startProducer(db, p.id, { ...request, text: "Other" }, mock),
  ).rejects.toThrow();
});
it("cancels a running model request without publishing a proposal", async () => {
  const p = createProject(db, "Song"),
    mock = new MockLanguageModelV4({
      doStream: async (options) => ({
        stream: new ReadableStream({
          start(controller) {
            options.abortSignal?.addEventListener(
              "abort",
              () => controller.error(new Error("cancelled")),
              { once: true },
            );
          },
        }),
      }),
    });
  await startProducer(
    db,
    p.id,
    { id: "cancel", text: "Wait", expected_version: 1 },
    mock,
  );
  await vi.waitFor(() => expect(mock.doStreamCalls).toHaveLength(1));
  tasks.get("cancel")!.abort();
  await vi.waitFor(() =>
    expect(requireRun(db, p.id, "cancel").status).toBe("cancelled"),
  );
  expect(JSON.parse(requireRun(db, p.id, "cancel").commands)).toEqual([]);
});

it('stages vocal score edits through approval and reports missing voices without direct mutation', async () => {
  const { vocalTools } = await import('./vocals/tools')
  const p = createProject(db, 'Singing')
  const session = createProducerTools(documentSchema.parse(JSON.parse(p.document)), () => {})
  session.propose([{ type: 'source.add', source: { id: 'singer', kind: 'vocal', duration: 4,
    notes: [{ id: 'n', pitch: 60, start: 0, duration: 1 }],
    vocal: { voice_id: 'not-installed', language: 'zh', syllables: { n: { kind: 'syllable', lyric: '你' } } } } }])
  expect(JSON.parse(getProject(db, p.id).document).sources).toEqual([])
  const { applyCommands } = await import('./projects')
  applyCommands(db, p.id, { expected_version: 1, commands: session.commands })
  const tools = vocalTools(db, p.id)
  const execute = tools.render_vocal.execute!
  const result = await execute({ source_id: 'singer', expected_version: 2 }, { toolCallId: 'test', messages: [], context: {} })
  expect(result).toMatchObject({ error: expect.stringContaining('not installed') })
  expect(getProject(db, p.id).version).toBe(2)
})

it('exposes the accepted version without advancing it when staging edits', async () => {
  const session = createProducerTools(documentSchema.parse({}), () => {}, undefined,
    { project_id: 'project', accepted_version: 7 })
  session.propose([{ type: 'project.set_tempo', tempo: 156 }])
  const inspected = await session.tools.inspect_project.execute!({}, { toolCallId: 'inspect', messages: [], context: {} })
  expect(inspected).toMatchObject({ project_id: 'project', accepted_version: 7, tempo: 156 })
})
it('returns actionable version conflicts from vocal tools without scheduling synthesis', async () => {
  const { vocalTools } = await import('./vocals/tools')
  const project = createProject(db, 'Version check')
  const result = await vocalTools(db, project.id).render_vocal.execute!(
    { source_id: 'singer', expected_version: project.version + 1 }, { toolCallId: 'render', messages: [], context: {} })
  expect(result).toMatchObject({ code: 'version_conflict', current_version: project.version, action: expect.stringContaining('Do not guess') })
})

it('carries lyric-only planning replies into subsequent composition requests', async () => {
  const project = createProject(db, 'Lyrics first')
  db.run("INSERT INTO producer_runs (id,project_id,base_version,prompt,status,commands,state,applied,created_at) VALUES (?,?,1,?,'complete','[]',NULL,0,?)",
    'lyrics-plan', project.id, 'Write the lyrics first', new Date().toISOString())
  append(db, 'lyrics-plan', { type: 'reply', text: 'LYRIC_PLAN: 星光化成信号' })
  const mock = model([[finish('stop')]])
  await produce(db, project, 'Arrange these lyrics', new AbortController().signal, () => {}, mock)
  expect(JSON.stringify(mock.doStreamCalls[0].prompt)).toContain('LYRIC_PLAN: 星光化成信号')
})

it('acknowledges accepted IDs and counts without echoing every note after each edit', () => {
  const session = createProducerTools(documentSchema.parse({}), () => {})
  const result = session.propose([{ type: 'source.add', source: { id: 'pattern', kind: 'notes', duration: 32,
    notes: Array.from({ length: 64 }, (_, i) => ({ id: `n${i}`, pitch: 60, start: i / 2, duration: 0.25 })) } }])
  expect(result).toMatchObject({ status: 'staged_for_review', staged_command_count: 1,
    project_summary: { sources: [{ id: 'pattern', duration: 32, note_count: 64 }] } })
  expect(JSON.stringify(result)).not.toContain('"pitch"')
  expect(session.getDocument().sources[0].notes).toHaveLength(64)
})
