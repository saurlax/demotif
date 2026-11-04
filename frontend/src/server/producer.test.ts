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
