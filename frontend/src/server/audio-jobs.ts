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
export const audioReady = () =>
  !!(
    config.audioURL &&
    config.audioKey &&
    config.audioBiz &&
    ffmpeg() &&
    !spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).error
  );
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
export function audioPayload(
  r: AudioRequest,
): [string, Record<string, unknown>] {
  if (r.mode === "speech")
    return [
      r.speech_model ? "cloudsway-elevenlabs-tts" : "302ai-elevenlabs-tts",
      {
        prompt: r.prompt,
        gen_type: "audio",
        audio_option: {
          type: "txt_2_speech",
          format: "mp3",
          voice: r.voice || "21m00Tcm4TlvDq8ikWAM",
        },
      },
    ];
  if (r.mode === "sound")
    return [
      "302ai-elevenlabs-sound-effects-v2",
      {
        prompt: r.prompt,
        gen_type: "audio",
        audio_option: {
          type: "txt_2_sound_effect",
          format: "mp3",
          duration: Math.round(r.duration_seconds * 1000),
        },
      },
    ];
  return [
    "ttapi-suno-v6",
    {
      prompt: r.prompt,
      gen_type: "music",
      music_option: {
        custom_mode: true,
        make_instrumental: r.instrumental,
        tags:
          (r.vocal_only
            ? "solo unaccompanied vocal, a cappella, voice only; "
            : "") + r.prompt,
        title: r.name,
        duration: Math.round(r.duration_seconds * 1000),
        ...(r.lyrics ? { lyrics: r.lyrics } : {}),
        ...(r.exclude || r.vocal_only
          ? {
              negative_tags:
                (r.vocal_only
                  ? "drums, percussion, piano, guitar, bass, synthesizer, pads, strings; "
                  : "") + r.exclude,
            }
          : {}),
      },
    },
  ];
}
async function gateway(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const url = config.audioURL.replace(/\/$/, "").replace(/\/v1$/, "") + path;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(!body ? { "X-Token": config.audioKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
  });
  if (!response.ok) throw new Error("Audio provider request failed");
  const result = JSON.parse(
    Buffer.from(
      await boundedBody(
        new Request("http://localhost", {
          method: "POST",
          body: response.body,
          duplex: "half",
        } as RequestInit),
        2 * 1024 * 1024,
      ),
    ).toString(),
  );
  if (result.base?.code || result.err_code)
    throw new Error("Audio provider reported a failure");
  return result;
}
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
    scope = request.mode === "transcribe" ? "analysis-v2" : config.audioURL,
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
      if (!job.upstream_id) {
        let [ability, payload] = audioPayload(request);
        if (request.mode === "separate") {
          const original = previous.find(
            (r) =>
              r.result.source?.asset_id === asset?.id &&
              !["separate", "transcribe"].includes(
                JSON.parse(r.job.request).mode,
              ),
          );
          if (
            !source ||
            !asset ||
            source.duration > 60 ||
            !original?.job.upstream_id
          )
            invalid(
              "Separation currently supports generated sources of at most 60 seconds",
            );
          const polled = await gateway(
              "/v1/get_submit_result/" +
                encodeURIComponent(original.job.upstream_id),
              signal,
            ),
            resources = JSON.parse(String(polled.resp_payload))
              .resources as Resource[],
            index = (
              JSON.parse(original.job.results) as AudioResult[]
            ).findIndex((r) => r.source?.asset_id === asset.id);
          ability = "byteplus-ai-mediakit-voice-separation-official";
          payload = {
            gen_type: "audio",
            resource_url: resources[index].url,
            audio_option: {
              type: "audio_2_audio",
              format: "wav",
              byteplus_mediakit: {
                voice_separation: { input_type: "audio", scene: "music" },
              },
            },
          };
        }
        const response = await gateway(
          "/v1/submit_async_atomic_process",
          signal,
          {
            ability_key: ability,
            req_payload: JSON.stringify(payload),
            token: config.audioKey,
            biz_info: { biz_id: config.audioBiz, enter_from: "demotif" },
            user_info: { uid: 1 },
          },
        );
        if (typeof response.task_id !== "string" || !response.task_id)
          throw new Error("Submission result unknown");
        job.upstream_id = response.task_id;
        // Persist upstream identity even if cancellation races its response.
        db.run(
          "UPDATE audio_jobs SET upstream_id=? WHERE id=?",
          job.upstream_id,
          id,
        );
        signal.throwIfAborted();
        db.run("UPDATE audio_jobs SET status='processing' WHERE id=?", id);
      }
      let resources: Resource[] | undefined;
      for (let i = 0; i < 200; i++) {
        const result = await gateway(
          "/v1/get_submit_result/" + encodeURIComponent(job.upstream_id!),
          signal,
        );
        if (result.task_id && result.task_id !== job.upstream_id)
          throw new Error("Provider task mismatch");
        if (result.status === "succeed") {
          resources = JSON.parse(String(result.resp_payload)).resources;
          break;
        }
        if (["failed", "error", "cancelled"].includes(String(result.status)))
          throw new Error("Provider task failed");
        await sleep(3000, signal);
      }
      if (!resources || resources.length < 1 || resources.length > 4)
        throw new Error("Invalid audio results");
      const directory = await mkdtemp(join(tmpdir(), "demotif-audio-"));
      try {
        const outputs: {
          data: Buffer;
          source: z.infer<typeof sourceSchema>;
          role: string;
          id: string;
        }[] = [];
        for (let i = 0; i < resources.length; i++) {
          const resource = resources[i],
            data = await download(resource.url, signal),
            path = join(directory, `input-${i}`),
            output = join(directory, `output-${i}.wav`);
          await import("node:fs/promises").then((fs) =>
            fs.writeFile(path, data),
          );
          await processFile(
            "ffmpeg",
            [
              "-nostdin",
              "-v",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-i",
              path,
              "-t",
              "301",
              "-ac",
              "2",
              "-ar",
              "44100",
              "-c:a",
              "pcm_s16le",
              "-y",
              output,
            ],
            signal,
            undefined,
            4096,
            60000,
          );
          const bytes = await readFile(output),
            probe = await processFile(
              "ffprobe",
              [
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                output,
              ],
              signal,
            ),
            duration = Number(JSON.parse(probe.toString()).format.duration),
            max =
              request.mode === "sound"
                ? 15
                : request.mode === "speech"
                  ? 30
                  : 60;
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            duration > max + 0.1
          )
            throw new Error("Provider output exceeds supported duration");
          const assetId = sha256Text(`${job.id}:${i}`).slice(0, 32),
            role = resource.meta_data?.audio_track?.kind ?? "",
            source = sourceSchema.parse({
              id: assetId,
              name: `${request.name} ${role || i + 1}`,
              kind: "audio",
              asset_id: assetId,
              duration,
            });
          outputs.push({ data: bytes, source, role, id: assetId });
          results.push({ source, role });
        }
        if (
          request.mode === "separate" &&
          JSON.stringify([...new Set(results.map((r) => r.role))].sort()) !==
            JSON.stringify(["background", "voice"])
        )
          throw new Error("Invalid separation results");
        signal.throwIfAborted();
        db.tx(() => {
          for (const o of outputs) {
            if (!db.get("SELECT id FROM assets WHERE id=?", o.id))
              storeAsset(
                db,
                job.project_id,
                `${o.source.name}.wav`,
                "audio/wav",
                o.data,
                "sample",
                undefined,
                o.id,
              );
          }
          db.run(
            "UPDATE audio_jobs SET status='complete',results=?,error=NULL WHERE id=?",
            JSON.stringify(results),
            id,
          );
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      return;
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
