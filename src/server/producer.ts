import { vocalTools } from "./vocals/tools";
import { createOpenAI } from "@ai-sdk/openai";
import {
  streamText,
  stepCountIs,
  tool,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import {
  commandSchema,
  documentSchema,
  partSchema,
  sourceSchema,
  newId,
  type Command,
  type Document,
} from "@/shared/schema";
import { SOUND_IDS } from "@/audio/soundDefinitions";
import { applyEdit, getProject, now, type ProjectRow } from "./projects";
import { config } from "./config";
import { runtime, type Store } from "./db";
import { ApiError, conflict, invalid, missing } from "./errors";
import {
  audioReady,
  analysisReady,
  audioRequestSchema,
  ensureAudio,
  type AudioRow,
  type AudioResult,
} from "./audio-jobs";
import { Slots } from "./jobs";
export interface RunRow {
  id: string;
  project_id: string;
  base_version: number;
  prompt: string;
  status: string;
  commands: string;
  state: string | null;
  applied: number;
  created_at: string;
}
interface EventRow {
  seq: number;
  payload: string;
}
const slots = new Slots(2);
export const producerReady = () =>
  !!(config.producerModel && config.producerKey);
export function append(
  db: Store,
  id: string,
  payload: Record<string, unknown>,
) {
  db.run(
    "INSERT INTO producer_events (run_id,seq,payload) SELECT ?,COALESCE(MAX(seq),0)+1,? FROM producer_events WHERE run_id=?",
    id,
    JSON.stringify(payload),
    id,
  );
}
export function requireRun(db: Store, projectId: string, id: string) {
  const run = db.get<RunRow>(
    "SELECT * FROM producer_runs WHERE id=? AND project_id=?",
    id,
    projectId,
  );
  return run ?? missing("Producer run not found");
}
export function producerHistory(db: Store, id: string) {
  getProject(db, id);
  return {
    ready: producerReady(),
    runs: db
      .all<RunRow>(
        "SELECT * FROM producer_runs WHERE project_id=? ORDER BY created_at",
        id,
      )
      .map((r) => ({
        id: r.id,
        prompt: r.prompt,
        status: r.status,
        base_version: r.base_version,
        applied: !!r.applied,
        commands: JSON.parse(r.commands),
        events: db
          .all<EventRow>(
            "SELECT * FROM producer_events WHERE run_id=? ORDER BY seq",
            r.id,
          )
          .map((e) => ({ seq: e.seq, ...JSON.parse(e.payload) })),
      })),
  };
}
const instructions = `You are Demotif's music producer. Respond in the user's language. Read the project before proposing edits.
Only propose typed reversible project edits. Musical time is quarter-note beats; recorded audio source windows use seconds.
Sources are shared. Respect locks. Never invent existing media IDs. Create stable IDs for new tracks, sources and notes.
Create sources, then place clips; a saved library clip alone is not audible. Use installed synth sounds. Vocal sources use monophonic notes and vocal metadata with note-ID syllables; use list_singing_voices before choosing a voice. Stage vocal edits through propose_edits. Synthesis uses the accepted score, so ask the user to apply pending edits before rendering. Never claim automatic pitch or duration prediction if a voice does not support it.
Use audio processing only when requested. Transcription needs review: keep original audio and place notes on a muted new track.
Use the supplied accepted project version for render_vocal.expected_version; staged edits do not advance it. Never guess or enumerate versions. On version_conflict, stop rendering and ask for a fresh request against the updated project.
Stage at most four edits per tool call. Explain what is proposed, never claim it is already applied.
Do not expose internal reasoning or promise microphone recording, external plugins or unavailable capabilities.`;
export function createProducerTools(
  document: Document,
  emit: (event: Record<string, unknown>) => void,
  processAudio?: (
    input: z.infer<typeof audioRequestSchema>,
  ) => Promise<unknown>,
  context?: { project_id: string; accepted_version: number },
) {
  let staged = structuredClone(document);
  const commands: Command[] = [];
  function propose(edits: unknown) {
    const parsed = z.array(commandSchema).min(1).max(4).parse(edits);
    if (commands.length + parsed.length > 512) invalid("Proposal is too large");
    const candidate = structuredClone(staged);
    try {
      for (const edit of parsed) {
        if ((edit.type === "track.add" || edit.type === "clip.add") && !edit.id)
          edit.id = newId();
        applyEdit(candidate, edit);
      }
      staged = documentSchema.parse(candidate);
    } catch (e) {
      emit({ type: "tool", name: "propose_edits", status: "rejected" });
      throw e;
    }
    commands.push(...parsed);
    emit({
      type: "tool",
      name: "propose_edits",
      count: parsed.length,
      status: "proposed",
    });
    return { status: "staged_for_review", project: staged, ...context };
  }
  const tools = {
    inspect_project: tool({
      description:
        "Read the staged project. Musical time is beats; audio sources use seconds.",
      inputSchema: z.object({}),
      execute: async () => ({ ...staged, ...context }),
    }),
    list_sounds: tool({
      description: "List installed sounds and drum kits; no generation.",
      inputSchema: z.object({}),
      execute: async () => ({
        sounds: SOUND_IDS,
        drum_kits: ["studio", "808", "909", "lofi"],
      }),
    }),
    propose_edits: tool({
      description:
        "Stage 1–4 edits atomically for user approval. No edits apply automatically.",
      inputSchema: z.object({ edits: z.array(commandSchema).min(1).max(4) }),
      execute: async ({ edits }) => {
        try {
          return propose(edits);
        } catch (e) {
          return {
            error: e instanceof Error ? e.message : "Invalid edit",
            status: "rejected",
          };
        }
      },
    }),
  };
  return {
    tools,
    commands,
    propose,
    getDocument: () => staged,
    ...(processAudio
      ? {
          audioTool: tool({
            description:
              "Generate music, speech or sound, separate generated vocals, or analyze at most 30 seconds of audio. Only on user request. Same arguments/take reuse a job; never vary take to retry.",
            inputSchema: audioRequestSchema,
            execute: processAudio,
          }),
        }
      : {}),
  };
}
export async function produce(
  db: Store,
  p: ProjectRow,
  prompt: string,
  signal: AbortSignal,
  emit: (e: Record<string, unknown>) => void,
  modelOverride?: LanguageModel,
) {
  let audioCalls = 0;
  const session = createProducerTools(
    documentSchema.parse(JSON.parse(p.document)),
    emit,
    async (input) => {
      signal.throwIfAborted();
      if (++audioCalls > 3) invalid("At most three audio calls per run");
      emit({ type: "tool", name: "process_audio", status: "processing" });
      const job = await ensureAudio(db, p.id, input),
        deadline = Date.now() + 600000;
      let current = job;
      while (current.status !== "complete") {
        if (["failed", "interrupted"].includes(current.status))
          invalid("Audio processing stopped; do not resubmit");
        if (Date.now() > deadline)
          invalid("Audio task timed out; do not resubmit");
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, 1000);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        current = db.get<AudioRow>(
          "SELECT * FROM audio_jobs WHERE id=?",
          job.id,
        )!;
      }
      const sources = [];
      for (const result of JSON.parse(current.results) as AudioResult[]) {
        const beat = 60 / session.getDocument().tempo;
        const source =
          result.source ??
          sourceSchema.parse({
            name: result.name,
            kind: "notes",
            duration: result.analysis!.duration / beat,
            notes: result.analysis!.notes.map((n) => ({
              ...n,
              id: newId(),
              start: n.start / beat,
              duration: n.duration / beat,
            })),
          });
        const edits: unknown[] = [];
        if (!session.getDocument().sources.some((s) => s.id === source.id))
          edits.push({ type: "source.add", source });
        edits.push({
          type: "part.add",
          part: partSchema.parse({
            name: source.name,
            source_id: source.id,
            duration: source.duration,
          }),
        });
        session.propose(edits);
        sources.push({
          source_id: source.id,
          duration: source.duration,
          kind: source.kind,
          review_required: !!result.analysis,
        });
      }
      return { results: sources, status: "proposed_for_review" };
    },
    { project_id: p.id, accepted_version: p.version },
  );
  const provider = createOpenAI({
    apiKey: config.producerKey,
    baseURL: config.producerURL || undefined,
  });
  const model =
    modelOverride ??
    (config.producerApi === "chat"
      ? provider.chat(config.producerModel)
      : provider.responses(config.producerModel));
  // Import visible historical replies, never assume Python harness checkpoints are SDK messages.
  const history: ModelMessage[] = [];
  for (const prior of db
    .all<RunRow>(
      "SELECT * FROM producer_runs WHERE project_id=? AND status='complete' AND applied=1 ORDER BY created_at",
      p.id,
    )
    .slice(-8)) {
    const events = db
      .all<EventRow>(
        "SELECT * FROM producer_events WHERE run_id=? ORDER BY seq",
        prior.id,
      )
      .map(
        (e) =>
          JSON.parse(e.payload) as {
            type: string;
            text?: string;
            delta?: string;
          },
      );
    const reply =
      events.findLast((e) => e.type === "reply")?.text ??
      events
        .filter((e) => e.type === "text")
        .map((e) => e.delta ?? "")
        .join("");
    history.push(
      { role: "user", content: prior.prompt },
      { role: "assistant", content: reply || "Edit proposal reviewed." },
    );
  }
  const messages: ModelMessage[] = [
    ...history,
    {
      role: "user",
      content:
        `Accepted project version: ${p.version} (staged edits do not change this version).\nProject data:\n` +
        JSON.stringify(JSON.parse(p.document)) +
        "\nUser:\n" +
        prompt,
    },
  ];
  const tools = {
    ...session.tools,
    ...vocalTools(db, p.id, emit),
    ...((audioReady() || analysisReady()) && session.audioTool
      ? { process_audio: session.audioTool }
      : {}),
  };
  const result = streamText({
    model,
    system: instructions,
    messages,
    tools,
    abortSignal: signal,
    stopWhen: stepCountIs(24),
    maxRetries: 0,
    providerOptions: {
      openai: { ...config.producerSettings, strictJsonSchema: false },
    },
  });
  for await (const part of result.fullStream) {
    signal.throwIfAborted();
    if (part.type === "text-delta") emit({ type: "text", delta: part.text });
    else if (part.type === "error") throw new Error("Producer request failed");
  }
  signal.throwIfAborted();
  const reply = await result.text;
  emit({ type: "reply", text: reply });
  return {
    commands: session.commands,
    state: {
      format: "ai-sdk-v1",
      messages: [...messages, ...(await result.responseMessages)],
    },
  };
}
export async function startProducer(
  db: Store,
  projectId: string,
  input: unknown,
  modelOverride?: LanguageModel,
) {
  const request = z
    .object({
      id: z.string().min(1).max(100),
      text: z.string().min(1).max(4000),
      expected_version: z.number().int().min(1),
    })
    .parse(input);
  const result = db.tx(() => {
    const p = getProject(db, projectId),
      existing = db.get<RunRow>(
        "SELECT * FROM producer_runs WHERE id=?",
        request.id,
      );
    if (existing) {
      if (
        existing.project_id !== projectId ||
        existing.prompt !== request.text ||
        existing.base_version !== request.expected_version
      )
        throw new ApiError(409, "request_conflict", "Run ID already used");
      return { existing, p };
    }
    if (!modelOverride && !producerReady())
      throw new ApiError(
        503,
        "producer_unavailable",
        "Configure the producer model and API key.",
      );
    if (p.version !== request.expected_version) conflict(p.version);
    if (
      db.get(
        "SELECT id FROM producer_runs WHERE project_id=? AND status='running'",
        projectId,
      )
    )
      throw new ApiError(
        409,
        "producer_running",
        "A producer run is already active",
      );
    db.run(
      "INSERT INTO producer_runs (id,project_id,base_version,prompt,status,commands,state,applied,created_at) VALUES (?,?,?,?,?,?,NULL,0,?)",
      request.id,
      projectId,
      p.version,
      request.text,
      "running",
      "[]",
      now(),
    );
    return { p };
  });
  if (result.existing)
    return { id: result.existing.id, status: result.existing.status };
  const r = await runtime(),
    controller = new AbortController();
  r.producerTasks.set(request.id, controller);
  void slots
    .run(controller.signal, async () => {
      const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(600000),
        ]),
        emit = (e: Record<string, unknown>) => {
          signal.throwIfAborted();
          append(db, request.id, e);
        };
      try {
        const output = await produce(
          db,
          result.p,
          request.text,
          signal,
          emit,
          modelOverride,
        );
        signal.throwIfAborted();
        db.tx(() => {
          db.run(
            "UPDATE producer_runs SET status='complete',commands=?,state=? WHERE id=? AND status='running'",
            JSON.stringify(output.commands),
            JSON.stringify(output.state),
            request.id,
          );
          append(db, request.id, { type: "status", status: "complete" });
        });
      } catch {
        db.tx(() => {
          const status = controller.signal.aborted ? "cancelled" : "failed";
          db.run(
            "UPDATE producer_runs SET status=? WHERE id=?",
            status,
            request.id,
          );
          append(db, request.id, {
            type: "error",
            text: signal.aborted
              ? "Producer stopped."
              : "Producer could not finish. Check the model configuration.",
          });
          append(db, request.id, { type: "status", status });
        });
      }
    })
    .catch(() => {
      db.run(
        "UPDATE producer_runs SET status='cancelled' WHERE id=? AND status='running'",
        request.id,
      );
    })
    .finally(() => r.producerTasks.delete(request.id));
  return { id: request.id, status: "running" };
}
export function eventStream(
  db: Store,
  projectId: string,
  id: string,
  after: number,
  signal: AbortSignal,
) {
  requireRun(db, projectId, id);
  let cursor = after,
    timer: ReturnType<typeof setTimeout> | undefined,
    closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", end);
        controller.close();
      };
      const tick = () => {
        if (closed) return;
        try {
          for (const e of db.all<EventRow>(
            "SELECT * FROM producer_events WHERE run_id=? AND seq>? ORDER BY seq",
            id,
            cursor,
          )) {
            cursor = e.seq;
            controller.enqueue(
              encoder.encode(
                `id: ${cursor}\ndata: ${JSON.stringify({ seq: cursor, ...JSON.parse(e.payload) })}\n\n`,
              ),
            );
          }
          if (requireRun(db, projectId, id).status !== "running") {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            end();
            return;
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          timer = setTimeout(tick, 500);
        } catch (e) {
          closed = true;
          controller.error(e);
        }
      };
      signal.addEventListener("abort", end, { once: true });
      if (signal.aborted) end();
      else tick();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
