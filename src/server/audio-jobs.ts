import { pythonJSON, sha256Text } from "./compatibility";
import { z } from "zod";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { config, repositoryRoot } from "./config";
import { runtime, type Store } from "./db";
import { getProject, now, type AssetRow } from "./projects";
import { sourceSchema, documentSchema } from "@/shared/schema";
import { ApiError, invalid } from "./errors";
import { boundedBody, safePath, storeAsset } from "./media";
import { Slots } from "./jobs";

export const audioRequestSchema = z
  .strictObject({
    mode: z.enum(["music", "speech", "sound", "separate", "transcribe"]),
    name: z.string().min(1).max(80).default("New audio"),
    prompt: z.string().max(1000).default(""),
    duration_seconds: z.number().min(0).max(60).default(30),
    lyrics: z.string().max(2000).default(""),
    instrumental: z.boolean().default(true),
    vocal_only: z.boolean().default(false),
    exclude: z.string().max(1000).default(""),
    voice: z.string().max(80).default(""),
    speech_model: z.enum(["", "eleven_v3"]).default(""),
    source_id: z.string().nullable().default(null),
    take: z.number().int().min(1).max(1000).default(1),
    analysis_mode: z.enum(["pitched", "percussion"]).default("pitched"),
    min_pitch: z.number().int().min(21).max(107).default(28),
    max_pitch: z.number().int().min(22).max(108).default(84),
    drum_pitch: z.number().int().min(0).max(127).default(42),
  })
  .superRefine((r, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (["separate", "transcribe"].includes(r.mode)) {
      if (!r.source_id || r.min_pitch >= r.max_pitch)
        fail("Select a source and valid pitch range");
    } else {
      if (!r.prompt.trim()) fail("A prompt is required");
      if (
        r.mode === "music" &&
        (!Number.isInteger(r.duration_seconds) || r.duration_seconds < 10)
      )
        fail("Music duration must be 10–60 whole seconds");
      if (
        r.mode === "sound" &&
        (r.duration_seconds < 0.5 || r.duration_seconds > 15)
      )
        fail("Sound effects must be 0.5–15 seconds");
      if (r.mode === "music" && !r.instrumental && !r.lyrics.trim())
        fail("Provide lyrics for vocals");
      if (r.vocal_only && (r.mode !== "music" || r.instrumental))
        fail("Vocal-only generation requires vocal music");
    }
  });
export type AudioRequest = z.infer<typeof audioRequestSchema>;
export interface AudioRow {
  id: string;
  project_id: string;
  status: string;
  request: string;
  upstream_id: string | null;
  results: string;
  error: string | null;
  created_at: string;
}
interface Resource {
  url: string;
  meta_data?: { audio_track?: { kind?: string } };
}
export interface AudioResult {
  source?: z.infer<typeof sourceSchema>;
  analysis?: {
    duration: number;
    notes: {
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
    }[];
  };
  name?: string;
  source_id?: string;
  role?: string;
}
const slots = new Slots(2);
const ffmpeg = () =>
  !spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error;
export const audioReady = () => false;
export const analysisReady = () =>
  existsSync(config.analysisPython) &&
  ffmpeg() &&
  spawnSync(config.analysisPython, ["-c", "import librosa"], {
    stdio: "ignore",
    timeout: 10000,
  }).status === 0;
export const publicJob = (j: AudioRow) => ({
  id: j.id,
  status: j.status,
  name: JSON.parse(j.request).name,
  mode: JSON.parse(j.request).mode,
  results: JSON.parse(j.results),
  error: j.error,
  can_resume: !!j.upstream_id && j.status !== "complete",
});
export async function publicAddress(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    !u.hostname ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new Error("Invalid media URL");
  const addresses = await lookup(u.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((a) => {
      let p = ipaddr.parse(a.address);
      if (p.kind() === "ipv6" && (p as ipaddr.IPv6).isIPv4MappedAddress())
        p = (p as ipaddr.IPv6).toIPv4Address();
      return p.range() !== "unicast";
    })
  )
    throw new Error("Media must use a public address");
  return addresses[0];
}
export async function download(
  url: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Buffer> {
  if (redirects > 3) throw new Error("Too many redirects");
  const address = await publicAddress(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        signal,
        timeout: 90000,
        lookup: (_host, _opts, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          download(
            new URL(res.headers.location, url).href,
            signal,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("Media download failed"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 60 * 1024 * 1024) {
            req.destroy(new Error("Audio exceeds 60 MB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Media download timed out")));
    req.on("error", reject);
    req.end();
  });
}
export function processFile(
  command: string,
  args: string[],
  signal: AbortSignal,
  input?: Buffer,
  max = 4 * 1024 * 1024,
  timeout = 90000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      }),
      chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > max) {
        child.kill();
        reject(new Error("Analysis output exceeds limit"));
      } else chunks.push(b);
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error("Audio processing failed")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
export async function ensureAudio(
  db: Store,
  projectId: string,
  input: unknown,
) {
  getProject(db, projectId);
  const request = audioRequestSchema.parse(input),
    scope = request.mode === "transcribe" ? "analysis-v2" : "unavailable",
    id = sha256Text(projectId + "\n" + scope + "\n" + pythonJSON(request));
  let existing = db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", id);
  if (existing) return existing;
  if (!(request.mode === "transcribe" ? analysisReady() : audioReady()))
    throw new ApiError(
      503,
      "audio_unavailable",
      "Audio provider or analysis dependencies are not configured.",
    );
  db.run(
    "INSERT INTO audio_jobs (id,project_id,status,request,upstream_id,results,error,created_at) VALUES (?,?,?, ?,NULL,?,NULL,?)",
    id,
    projectId,
    "submitting",
    JSON.stringify(request),
    "[]",
    now(),
  );
  existing = db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", id)!;
  await startAudio(id);
  return existing;
}
export async function startAudio(id: string) {
  const r = await runtime();
  if (r.audioTasks.has(id)) return;
  const controller = new AbortController();
  r.audioTasks.set(id, controller);
  void slots
    .run(controller.signal, () =>
      execute(
        r.store,
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(660000)]),
      ),
    )
    .catch(() => {
      r.store.run(
        "UPDATE audio_jobs SET status='interrupted',error=? WHERE id=? AND status!='complete'",
        "Stopped; submitted tasks are not resubmitted.",
        id,
      );
    })
    .finally(() => r.audioTasks.delete(id));
}
async function execute(db: Store, id: string, signal: AbortSignal) {
  try {
    const job = db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", id)!,
      request = audioRequestSchema.parse(JSON.parse(job.request)),
      document = documentSchema.parse(
        JSON.parse(getProject(db, job.project_id).document),
      );
    const completed = db.all<AudioRow>(
      "SELECT * FROM audio_jobs WHERE project_id=? AND status='complete'",
      job.project_id,
    );
    const previous = completed.flatMap((j) =>
      (JSON.parse(j.results) as AudioResult[]).map((r) => ({
        job: j,
        result: r,
      })),
    );
    const source =
      document.sources.find((s) => s.id === request.source_id) ??
      previous.find((r) => r.result.source?.id === request.source_id)?.result
        .source;
    const asset = source?.asset_id
      ? db.get<AssetRow>(
          "SELECT * FROM assets WHERE id=? AND project_id=?",
          source.asset_id,
          job.project_id,
        )
      : undefined;
    let results: AudioResult[] = [];
    if (request.mode === "transcribe") {
      if (!source || source.kind !== "audio" || !asset || source.duration > 30)
        invalid("Choose an audio source of at most 30 seconds");
      const pcm = await processFile(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          safePath(config.media, asset.storage_key),
          "-t",
          "30.001",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "f32le",
          "pipe:1",
        ],
        signal,
        undefined,
        30 * 16000 * 4 + 1024,
        45000,
      );
      if (pcm.length > 30 * 16000 * 4)
        invalid("Analyze sources of at most 30 seconds");
      const raw = await processFile(
        config.analysisPython,
        [
          resolve(repositoryRoot, "analysis/transcribe.py"),
          request.analysis_mode,
          String(request.min_pitch),
          String(request.max_pitch),
          String(request.drum_pitch),
        ],
        signal,
        pcm,
      );
      results = [
        {
          analysis: JSON.parse(raw.toString()),
          name: request.name,
          source_id: source.id,
        },
      ];
    } else {
      throw new Error("Remote audio unavailable");
    }
    signal.throwIfAborted();
    db.run(
      "UPDATE audio_jobs SET status='complete',results=?,error=NULL WHERE id=?",
      JSON.stringify(results),
      id,
    );
  } catch {
    db.run(
      "UPDATE audio_jobs SET status=?,error=? WHERE id=? AND status!=?",
      signal.aborted ? "interrupted" : "failed",
      "Audio processing stopped. Resume a known upstream task rather than resubmitting.",
      id,
      "complete",
    );
  }
}
