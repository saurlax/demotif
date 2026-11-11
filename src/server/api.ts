import {completeBrowserRender} from './producer-render';
import {completeStudioControl} from './producer-control';
import {continueRecordedProducer} from './producer';
import { sha256Text } from "./compatibility";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { runtime } from "./db";
import { config } from "./config";
import { directSession, reserveUpload, finishUpload } from './direct-transfers';
import { proxyAPI } from './upstream';
import { ApiError, conflict, invalid, missing } from "./errors";
import {
  documentSchema,
  sourceSchema,
  tempoSchema,
  timeSignature,
  audioContextSchema,
} from "@/shared/schema";
import {
  applyCommands,
  cloneDocument,
  copyProject,
  createProject,
  getProject,
  readProject,
  saveDraft,
  undo,
  type AssetRow,
} from "./projects";
import { safePath, storeAsset, boundedBody } from "./media";
import {transcribeVoice,speakReply} from './producer-voice';
import {realtimeCapabilities} from './producer-realtime-session';
import { listExamples, loadExample } from "./examples";
import { vocals, voices } from './vocals/jobs';
import {
  append,
  eventStream,
  producerHistory,
  producerReady,
  requireRun,
  startProducer,
  commandTargets,
} from "./producer";
import {
  analysisReady,
  audioReady,
  ensureAudio,
  publicJob,
  startAudio,
  type AudioRow,
  audioCapabilities, audioProposal, acceptAudio,
  registerRenderedAudio,
} from "./audio-jobs";
interface Preset {
  id: string;
  name: string;
  kind: string;
  sound?: string;
  drum_kit?: string;
  file?: string;
  root_note?: number;
  duration?: number;
  sampler?: boolean;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function handle(request: Request): Promise<Response> {
  try {
    if (config.upstream) return await proxyAPI(request, config.upstream);
    const url = new URL(request.url),
      path = url.pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent),
      method = request.method;
    const r = await runtime(),
      db = r.store;
    const body = () => request.json() as Promise<unknown>;
    if (path[0] === "health" && path.length === 1 && method === "GET")
      return json({ status: "ok", environment: config.environment });
    if (path[0] === 'vocal-voices' && path.length === 1 && method === 'GET')
      return json({ voices: voices() });
    if(path[0]==='audio-models'&&path.length===1&&method==='GET')return json({models:await audioCapabilities()});
    if (path[0] === "capabilities" && path.length === 1 && method === "GET")
      return json({
        producer: producerReady(),
        audio_generation: audioReady(),
        vocal_separation: false,
        transcription: analysisReady(),
      });
    if (path[0] === "sounds") {
      const catalog = JSON.parse(
        readFileSync(safePath(config.resources, "catalog.json"), "utf8"),
      ) as { entries: Preset[] };
      if (path.length === 1 && method === "GET")
        return json({
          entries: catalog.entries.map((e) => {
            const { file, ...entry } = e;
            return {
              ...entry,
              ...(file ? { preview_url: `/api/sounds/${e.id}/preview` } : {}),
            };
          }),
        });
      if (
        path[2] === "preview" &&
        path.length === 3 &&
        ["GET", "HEAD"].includes(method)
      ) {
        const p = catalog.entries.find((p) => p.id === path[1]);
        if (!p?.file) missing("Audio preview not found");
        const catalogRow = db.get<{manifest:string}>('SELECT manifest FROM storage_catalogs WHERE id=?','sounds');
        const binary = catalogRow && (JSON.parse(catalogRow.manifest).files as {path:string;ref:{key:string}}[]).find(f => f.path === p.file);
        if (!binary) missing('Preview is not published in object storage');
        return json(await directSession(binary.ref.key));
      }
    }
    if (path[0] !== "projects") missing();
    if (path.length === 1) {
      if (method === "GET")
        return json(
          db.all(
            "SELECT id,name,version,created_at,updated_at FROM projects WHERE is_draft=0 ORDER BY updated_at DESC",
          ),
        );
      if (method === "POST") {
        const data = z
          .object({
            name: z.string().min(1).max(200).default("Untitled"),
            tempo: tempoSchema.default(120),
            time_signature: timeSignature.default("4/4"),
          })
          .parse(await body());
        return json(
          db.tx(() =>
            readProject(
              db,
              createProject(db, data.name, {
                tempo: data.tempo,
                time_signature: data.time_signature,
              }),
            ),
          ),
          201,
        );
      }
    }
    if (path[1] === "examples") {
      if (path.length === 2 && method === "GET") return json(listExamples());
      if (path.length === 3 && method === "POST")
        return json(await loadExample(db, path[2]), 201);
      missing();
    }
    if (path[1] === "import" && path.length === 2 && method === "POST") {
      const payload = z
        .object({
          name: z.string().min(1).max(200).default("Imported project"),
          document: documentSchema,
        })
        .parse(await body());
      return json(
        db.tx(() => {
          const p = createProject(db, payload.name);
          const source = { ...p, document: JSON.stringify(payload.document) };
          const document = cloneDocument(db, source, p.id, true);
          db.run(
            "UPDATE projects SET document=? WHERE id=?",
            JSON.stringify(document),
            p.id,
          );
          return readProject(db, getProject(db, p.id));
        }),
        201,
      );
    }
    const projectId = path[1];
    if (!projectId) missing();
    const project = getProject(db, projectId);
    if (path[2] === 'exports' && path.length === 3) {
      if (method === 'GET') return json(db.all('SELECT * FROM audio_exports WHERE project_id=? ORDER BY created_at DESC', projectId));
      if (method === 'POST') throw new ApiError(410,'direct_transfer_required','Use a direct upload reservation for exports.');
    }
    if (path[2] === 'uploads') {
      if (path.length === 3 && method === 'POST') return json(await reserveUpload(db,projectId,await body()),201);
      if (path.length === 5 && path[4] === 'complete' && method === 'POST') return json(await finishUpload(db,projectId,path[3]),201);
    }
    if (path[2] === 'vocal-renders') {
      const queue = vocals(db);
      if (path.length === 3 && method === 'POST') return json(queue.ensure(projectId, await body()), 202);
      if (path.length === 4 && method === 'GET') return json(queue.status(projectId, path[3]));
      if (path.length === 5 && path[4] === 'cancel' && method === 'POST') return json(queue.cancel(projectId, path[3]));
    }
    if (path[2] === 'vocal-sources' && path.length === 5 && path[4] === 'render' && method === 'GET') {
      const expected = url.searchParams.get('expected_version');
      if (expected != null && z.coerce.number().int().parse(expected) !== project.version) conflict(project.version);
      return json(vocals(db).current(projectId, path[3]));
    }
    if (path.length === 2 && method === "GET")
      return json(readProject(db, project));
    if (path[2] === "drafts" && path.length === 3 && method === "POST")
      return json(copyProject(db, projectId, true), 201);
    if (path[2] === "save" && path.length === 3 && method === "POST")
      return json(saveDraft(db, projectId, await body()));
    if (path[2] === "copy" && path.length === 3 && method === "POST")
      return json(copyProject(db, projectId), 201);
    if (path[2] === "revisions" && path.length === 3 && method === "GET")
      return json(
        db.all(
          "SELECT project_id,version,summary,created_at FROM operations WHERE project_id=? ORDER BY version DESC",
          projectId,
        ),
      );
    if (path[2] === "commands" && method === "POST") {
      if (path.length !== 3 && !(path.length === 4 && path[3] === "batch"))
        missing();
      const payload = await body();
      if (path[3] === "batch")
        return json(applyCommands(db, projectId, payload, true));
      const input = z
        .object({
          expected_version: z.number().int().min(1),
          command: z.unknown(),
        })
        .parse(payload);
      return json(
        applyCommands(db, projectId, {
          expected_version: input.expected_version,
          commands: [input.command],
        }),
      );
    }
    if (path[2] === "undo" && path.length === 3 && method === "POST") {
      const input = z
        .object({ expected_version: z.number().int().min(1) })
        .parse(await body());
      return json(undo(db, projectId, input.expected_version));
    }
    if (path[2] === "assets") {
      if (path.length === 3 && method === "GET")
        return json(
          db.all(
            "SELECT id,project_id,kind,filename,content_type,size_bytes,created_at FROM assets WHERE project_id=? ORDER BY created_at DESC",
            projectId,
          ),
        );
      if (path.length === 3 && method === 'POST') throw new ApiError(410,'direct_transfer_required','Use a direct upload reservation.');
      if (
        path[4] === "content" &&
        path.length === 5 &&
        ["GET", "HEAD"].includes(method)
      ) {
        const asset =
          db.get<AssetRow>(
            "SELECT * FROM assets WHERE id=? AND project_id=?",
            path[3],
            projectId,
          ) ?? missing("Asset not found");
        if (!asset.storage_key.startsWith('s3:')) throw new ApiError(503,'asset_not_migrated','Audio is not published in object storage');
        return json(await directSession(asset.storage_key.slice(3)));
      }
    }
    if (path[2] === "sounds" && path.length === 3 && method === "POST") {
      const input = z
          .object({
            preset_id: z.string(),
            as_instrument: z.boolean().default(false),
          })
          .parse(await body()),
        catalog = JSON.parse(
          readFileSync(safePath(config.resources, "catalog.json"), "utf8"),
        ) as { entries: Preset[] },
        preset =
          catalog.entries.find((p) => p.id === input.preset_id) ??
          missing("Sound not found");
      const source = sourceSchema.parse({
        name: preset.name,
        kind: preset.kind === "drums" ? "drums" : "notes",
        sound: preset.sound ?? "piano",
        drum_kit: preset.drum_kit ?? "studio",
      });
      if (preset.file) {
        const asset = await storeAsset(
          db,
          projectId,
          preset.file,
          "audio/wav",
          readFileSync(safePath(config.resources, preset.file)),
        );
        source.asset_id = asset.id;
        if (input.as_instrument || preset.sampler)
          source.sampler = {
            rootNote: preset.root_note ?? 60,
            oneShot: true,
            loopStart: null,
            loopEnd: null,
          };
        else {
          source.kind = "audio";
          source.duration = preset.duration!;
        }
      }
      return json(source);
    }
    if(path[2]==='audio-renders'&&path.length===3&&method==='POST') {
      const input=z.object({asset_id:z.string(),name:z.string().min(1).max(80),context:audioContextSchema}).parse(await body());
      return json(publicJob(await registerRenderedAudio(db,projectId,input,request.signal)));
    }
    if (path[2] === "audio-jobs") {
      if (path.length === 3 && method === "GET")
        return json(
          db
            .all<AudioRow>(
              "SELECT * FROM audio_jobs WHERE project_id=? ORDER BY created_at DESC",
              projectId,
            )
            .map(publicJob),
        );
      if (path.length === 3 && method === "POST")
        return json(
          publicJob(await ensureAudio(db, projectId, await body())),
          202,
        );
      if (path.length !== 5 || method !== "POST") missing();
      const job =
        db.get<AudioRow>(
          "SELECT * FROM audio_jobs WHERE id=? AND project_id=?",
          path[3],
          projectId,
        ) ?? missing("Audio job not found");
      if(path[4]==='review'||path[4]==='accept') {
        const input=z.object({context:audioContextSchema,request_id:z.string().min(1).max(100).optional()}).parse(await body());
        if(path[4]==='review')return json({commands:audioProposal(db,projectId,job,input.context)});
        if(!input.request_id)invalid('Request identity is required');
        return json(acceptAudio(db,projectId,job,input.context,input.request_id));
      }
      if (method === "POST") {
        if (
          path[4] === "resume" &&
          JSON.parse(job.request).mode === 'transcribe' &&
          job.upstream_id &&
          job.status !== "complete"
        ) {
          if (!r.audioTasks.has(job.id)) {
            db.run(
              "UPDATE audio_jobs SET status='processing',error=NULL WHERE id=?",
              job.id,
            );
            await startAudio(job.id);
          }
        } else if (path[4] === "cancel") {
          r.audioTasks.get(job.id)?.abort();
          if (!["complete", "failed"].includes(job.status))
            db.run(
              "UPDATE audio_jobs SET status='interrupted' WHERE id=?",
              job.id,
            );
        } else
          throw new ApiError(
            409,
            "cannot_resume",
            "This task cannot be resumed or submitted again automatically.",
          );
        return json(
          publicJob(
            db.get<AudioRow>("SELECT * FROM audio_jobs WHERE id=?", job.id)!,
          ),
        );
      }
    }
    if (path[2] === "producer") {
      if(path[3]==='voice'&&path[4]==='capabilities'&&path.length===5&&method==='GET')return json(realtimeCapabilities());
      if(path[3]==='voice'&&path[4]==='transcriptions'&&path.length===5&&method==='POST'){
        if(!project.is_draft)invalid('Open an editing draft before using voice');
        return json({text:await transcribeVoice(await boundedBody(request),request.signal)});
      }
      if (path.length === 3 && method === "GET")
        return json(producerHistory(db, projectId));
      if (path[3] === "runs" && path.length === 4 && method === "POST")
        return json(await startProducer(db, projectId, await body()), 202);
      if (path[3] !== "runs" || path.length !== 6) missing();
      const run = requireRun(db, projectId, path[4]);
      if(path[5]==='recording'&&method==='POST')return json(await continueRecordedProducer(db,projectId,run.id,await body()),202);
      if(path[5]==='control'&&method==='POST')return json(completeStudioControl(db,projectId,run.id,await body()));
      if(path[5]==='render'&&method==='POST')return json(await completeBrowserRender(db,projectId,run.id,await body(),request.signal));
      if(path[5]==='speech'&&method==='POST'){
        if(run.status!=='complete')throw new ApiError(409,'speech_unavailable','Wait for the Producer reply before speaking.');
        const events=db.all<{payload:string}>('SELECT payload FROM producer_events WHERE run_id=? ORDER BY seq',run.id).map(e=>JSON.parse(e.payload));
        const reply=events.findLast(e=>e.type==='reply')?.text??events.filter(e=>e.type==='text').map(e=>e.delta??'').join('');
        const bytes=await speakReply(reply,request.signal);
        return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length),'Cache-Control':'no-store'}});
      }
      if (path[5] === "events" && method === "GET") {
        const after = Number(
          url.searchParams.get("after") ??
            request.headers.get("Last-Event-ID") ??
            0,
        );
        if (!Number.isSafeInteger(after) || after < 0)
          invalid("Invalid event cursor");
        return eventStream(db, projectId, run.id, after, request.signal);
      }
      if (path[5] === "cancel" && method === "POST") {
        r.producerTasks.get(run.id)?.abort();
        if (run.status === "running")
          db.tx(() => {
            db.run(
              "UPDATE producer_runs SET status='cancelled' WHERE id=?",
              run.id,
            );
            append(db, run.id, { type: "status", status: "cancelled" });
          });
        return json({
          id: run.id,
          status: requireRun(db, projectId, run.id).status,
        });
      }
      if (path[5] === "apply" && method === "POST") {
        const commands = JSON.parse(run.commands) as unknown[];
        if (run.status !== "complete" || !commands.length)
          throw new ApiError(
            409,
            "proposal_unavailable",
            "No completed edit proposal",
          );
        for(const target of commandTargets(z.array((await import('@/shared/schema')).commandSchema).parse(commands)))append(db,run.id,{type:'activity',status:'applying',target,text:'Applying edits'});
        const result = applyCommands(
          db,
          projectId,
          {
            request_id: `producer-${sha256Text(run.id)}`,
            expected_version: run.base_version,
            commands,
          },
          true,
        );
        db.run("UPDATE producer_runs SET applied=1 WHERE id=?", run.id);
        for(const target of commandTargets(z.array((await import('@/shared/schema')).commandSchema).parse(commands)))append(db,run.id,{type:'activity',status:'applied',target,text:'Edits applied'});
        return json(result);
      }
    }
    if (path[2] === "messages" && path.length === 3 && method === "POST") {
      const payload = z
        .object({
          text: z.string().min(1).max(4000),
          expected_version: z.number().int(),
        })
        .parse(await body());
      if (payload.expected_version !== project.version)
        conflict(project.version);
      const { produce } = await import("./producer");
      let reply = "";
      const output = await produce(
        db,
        project,
        payload.text,
        AbortSignal.any([request.signal, AbortSignal.timeout(600000)]),
        (e) => {
          if (e.type === "reply") reply = String(e.text);
        },
      );
      return json({ reply, commands: output.commands });
    }
    missing();
  } catch (error) {
    if (error instanceof ApiError)
      return json(
        { code: error.code, message: error.message, ...error.payload },
        error.status,
      );
    if (error instanceof z.ZodError)
      return json(
        {
          code: "invalid_command",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
            .slice(0, 1000),
        },
        422,
      );
    if (error instanceof SyntaxError)
      return json(
        { code: "invalid_request", message: "Invalid JSON request" },
        422,
      );
    console.error(
      "Demotif API request failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    return json(
      {
        code: "internal_error",
        message: "The request could not be completed.",
      },
      500,
    );
  }
}
