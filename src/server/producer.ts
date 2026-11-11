import {sha256Text} from './compatibility';
import {requestBrowserRender,selectedAudioReference} from './producer-render';
import {requestStudioControl,recordingContinuation,recordingContinuationPrompt} from './producer-control';
import {transportActionSchema,recordingPlanSchema,savePlanSchema,type StudioAction} from '@/shared/studio-control';
import { vocalTools } from "./vocals/tools";
import {producerModels} from '../shared/producer-models.mjs';
import { audioContextSchema, producerTargetSchema, type ProducerTarget, type AudioContext } from '@/shared/schema';
import { validateAudioContext, audioCapabilities } from './audio-jobs';
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
  newId,
  sourceSchema,
  type Command,
  type Document,
} from "@/shared/schema";
import { SOUND_IDS } from "@/audio/soundDefinitions";
import { applyCommands, applyEdit, getProject, now, type ProjectRow } from "./projects";
import { config } from "./config";
import { runtime, type Store } from "./db";
import { ApiError, conflict, invalid, missing } from "./errors";
import {
  audioReady, audioProposal,
  analysisReady,
  audioRequestSchema,
  ensureAudio,
  type AudioRow,
  type AudioResult,
} from "./audio-jobs";
import { Slots } from "./jobs";
import { planYue2Score, renderYue2Arrangement, renderYue2Song, yue2InputSchema, yue2ScoreCommands } from './yue2-score';
import { prepareAsset, publishAsset } from './media';
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
export function commandTargets(edits:Command[],before?:Document):ProducerTarget[] {
  return edits.map(edit=>producerTargetSchema.parse({
    ...(edit.type==='track.add'&&edit.id?{track_id:edit.id}:{}),
    ...(edit.type==='clip.add'&&edit.id?{clip_id:edit.id}:{}),
    ...(edit.type==='source.add'?{source_id:edit.source.id}:{}),
    ...('track_id' in edit?{track_id:edit.track_id}:{}),
    ...('clip_id' in edit?{clip_id:edit.clip_id}:{}),
    ...('source_id' in edit&&edit.source_id?{source_id:edit.source_id}:{}),
    ...(edit.type==='source.update'&&edit.notes?{note_ids:edit.notes.filter(n=>!before||JSON.stringify(before.sources.find(s=>s.id===edit.source_id)?.notes.find(old=>old.id===n.id))!==JSON.stringify(n)).map(n=>n.id)}:{}),
    ...('start_beat' in edit?{start_beat:edit.start_beat}:{}),
  }));
}
export const producerReady = () =>
  !!(config.producerModel && config.llmKey);
export function producerModelChoices() {
  return producerModels.some(model=>model.id===config.producerModel)?[...producerModels]:[...producerModels,{id:config.producerModel,name:config.producerModel}].filter(m=>m.id);
}
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
  const runs = db
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
      }));
  // A realtime turn and its delegated text run are one visible conversation item.
  // Keep the delegated run ID so SSE progress, cancellation and Undo keep their existing semantics.
  const linked=new Map(runs.flatMap(voice=>{
    const delegation=voice.events.find(e=>e.type==='delegation');
    return delegation?[[delegation.run_id as string,voice] as const]:[];
  }));
  const voices=new Set([...linked.values()].map(r=>r.id));
  return {ready:producerReady(),models:producerModelChoices(),model:config.producerModel,runs:runs.filter(r=>!voices.has(r.id)).map(original=>{
    const run=original.events.some(e=>e.type==='input'&&e.mode==='recording_result')?{...original,prompt:''}:original;
    const voice=linked.get(run.id);if(!voice)return run;
    const spoken=run.status!=='running'?voice.events.findLast(e=>e.type==='reply'&&e.text):undefined;
    const events=spoken?[...run.events.filter(e=>e.type!=='reply'&&e.type!=='text'),{...spoken,seq:Math.max(0,...run.events.map(e=>e.seq))+1}]:run.events;
    return {...run,prompt:voice.prompt==='Voice message'?run.prompt:voice.prompt,events};
  })};
}
const instructions = `You are Demotif's music producer. Respond in the user's language. Read the project before proposing edits.
For composing, arranging, extending with new musical material, or substantially rewriting music, use render_yue2_song (YuE2 Render) first. The default stages the stereo mix and the editable score from the same render. Use generate_score only when the user explicitly asks for Plan, score-only, or notes without rendered audio. If the user requests only the stereo audio, set audio_only on render_yue2_song. Do not hand-write a replacement arrangement with propose_edits. If the requested tool is unavailable or fails, explain the issue. Use direct edits for targeted changes to existing music, such as correcting a few notes, changing a sound, moving a Clip, or adjusting the mix. Report which requested parts the ABC does not provide as separate tracks.
Only propose typed reversible project edits. Musical time is quarter-note beats; recorded audio source windows use seconds.
Sources are shared. Respect locks. Never invent existing media IDs. Create stable IDs for new tracks, sources and notes.
Create sources, then place clips; a saved library clip alone is not audible. Use installed synth sounds. Vocal sources use monophonic notes and vocal metadata with note-ID syllables; use list_singing_voices before choosing a voice. Stage vocal edits through propose_edits. Synthesis uses the accepted score, so finish the run to commit pending score edits before rendering in a subsequent request. Never claim automatic pitch or duration prediction if a voice does not support it.
For faithful Clip-to-Sound conversion use render_clip. For a requested style/sound variation render note Clips first with reference_only=true, then use the resulting audio as a supported music reference. Use accepted instrument/sampler metadata to choose sensible default styles, never invent details you cannot hear. To convert Sound to Notes use local transcribe, then refine the staged note source with propose_edits if the user requested a style; keep the original and never claim analysis itself changes musical style. For audio requests, infer the intent, inspect list_audio_models, and select a ready model and supported parameters yourself. Never route a song request to speech or claim unsupported categories are available. If essential information is missing, ask a concise question. Do not require the user to choose a model. Use audio processing only when requested. Transcription needs review: keep original audio and place notes on a muted new track.
Use the supplied accepted project version for render_vocal.expected_version; staged edits do not advance it. Never guess or enumerate versions. On version_conflict, stop rendering and ask for a fresh request against the updated project.
Conversion tools stage final source/track/Clip placement automatically unless reference_only=true. When commands_already_staged is returned, do not add duplicate tracks or Clips, and do not lock, mute, remove or otherwise change the original unless the user explicitly requested that change. The placements returned by the tool are staged until this run finishes, then applied automatically as one undoable draft edit. Do not ask for approval or mention an Apply button. After conversion, continue only with explicitly requested refinement or musical continuation; otherwise finish and describe the result. Stage at most four edits per tool call. Describe what will change; final application is performed by the server after your reply. The user can undo the batch.
Use control_studio for metronome, playback and stop. Use record_audio only when the user intends to record humming or singing; ambient sound or spontaneous humming alone is not a recording request. Before recording, resolve WHICH phrase, WHERE its Clip belongs (explicit existing audio track or named new track), and its START and END in project beats. Ask a brief combined question in musical language if choices are unresolved; propose a concrete track/range as a question when useful. Do not list internal tool requirements, discuss guessing policies or make the user work with zero-based protocol positions. A user-referenced selected Clip or unique named section can supply its accepted range. Once the user intent and choices are clear, call record_audio directly without requiring a button click or another approval. Dry humming uses accompaniment=false. Humming or singing defaults to keep_audio: expression of a melody/rhythm or recording a real vocal does not itself request notation. Use transcribe_notes only when the user explicitly requests notation or editable notes. Audio can also remain a reference for later creation without transcription. The range ends automatically; do not tell users to speak a stop command while singing because conversation uplink is held. A successful result means prepared, not captured: finish with ONE short natural preparation sentence. Do not say armed, recap all confirmed parameters or add unsolicited singing coaching. The browser starts after this final speech drains, then returns a verified recorded Clip in a new application event. Do not call play after arming or mix staged content edits with recording preparation. Recording placement preserves old Clips and respects target locks. Use existing process_audio for explicitly requested audio-to-notes and propose_edits for requested note continuation; do not duplicate automatically staged placements. Report the analysis's measured notes; do not invent acoustic causes for a mismatch or blame the user's performance without evidence. Use save_project and export_audio only when requested, wait for their real browser results, and do not mix file operations with staged musical edits. Never invent success without acknowledgement. Do not expose internal reasoning or promise external plugins or unavailable capabilities.`;
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
    const parsed = z.array(commandSchema).min(1).parse(edits);
    if (commands.length + parsed.length > 512) invalid("Proposal is too large");
    const candidate = structuredClone(staged);
    const targets=commandTargets(parsed,staged);
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
    for(const target of targets)emit({type:'activity',status:'proposed',target,text:'Edits proposed'});
    emit({
      type: "tool",
      name: "propose_edits",
      count: parsed.length,
      status: "proposed",
    });
    return {
      status: "staged_for_review",
      staged_command_count: commands.length,
      ...context,
      project_summary: {
        tempo: staged.tempo,
        time_signature: staged.time_signature,
        tracks: staged.tracks.map((track) => ({ id: track.id, name: track.name, clip_count: track.clips.length })),
        sources: staged.sources.map((source) => ({ id: source.id, name: source.name, kind: source.kind, duration: source.duration, note_count: source.notes.length })),
        parts: staged.parts.map((part) => ({ id: part.id, name: part.name, source_id: part.source_id })),
        sections: staged.sections,
      },
      // inspect_project remains available when exact notes or clip geometry are needed.
    };
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
        "Stage 1–4 validated edits per call. The complete batch applies automatically to the current draft when this run finishes; users can undo it.",
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
              "Generate or process audio with a ready ElevenLabs model or analyze at most 30 seconds of audio. Infer the requested operation from the user message. Discover ready models with list_audio_models and choose the model and supported voice yourself; do not ask the user to select a model. Only on user request. Use sound with loop=true for seamless loops; use isolate for speech cleanup, not full music stems. recognize returns words/text, align requires the known text in prompt; transcribe is local audio-to-notes. Same arguments/take reuse a job; never vary take to retry.",
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
  target?: ProducerTarget,
  audioContext?: AudioContext,
  selectedModel?: string,
  voice = false,
  runId?:string,
  clientId?:string,
) {
  if(target)emit({type:'activity',status:'working',target,text:'Inspecting selection'});
  let audioCalls = 0;
  function stageAudio(job:AudioRow,context:AudioContext){
    const results=JSON.parse(job.results) as AudioResult[];
    if(results.some(r=>r.transcript))return {job_id:job.id,transcripts:results.flatMap(r=>r.transcript?[r.transcript]:[])};
    const edits=audioProposal(db,p.id,job,context).filter(c=>{
      const d=session.getDocument();
      if(c.type==='source.add')return !d.sources.some(s=>s.id===c.source.id);
      if(c.type==='part.add')return !d.parts.some(part=>part.id===c.part.id);
      if(c.type==='track.add')return !d.tracks.some(t=>t.id===c.id);
      if(c.type==='clip.add')return !d.tracks.some(t=>t.clips.some(clip=>clip.id===c.id));
      return true;
    });
    for(let i=0;i<edits.length;i+=4)session.propose(edits.slice(i,i+4));
    const sourceIds=edits.flatMap(c=>c.type==='clip.add'&&c.source_id?[c.source_id]:[]);
    const sources=sourceIds.map(id=>session.getDocument().sources.find(s=>s.id===id)!).filter(Boolean);
    if(results.some(r=>r.analysis&&!r.source))db.run('UPDATE audio_jobs SET results=? WHERE id=?',JSON.stringify(results.map((r,i)=>r.analysis&&!r.source?{...r,source:sources[i]}:r)),job.id);
    return {job_id:job.id,results:sources,status:'already_staged_for_user_review',commands_already_staged:true,placements:edits.filter(c=>c.type==='clip.add'),reference_source_id:sources[0]?.id};
  }
  const session = createProducerTools(
    documentSchema.parse(JSON.parse(p.document)),
    emit,
    async (input) => {
      signal.throwIfAborted();
      if (++audioCalls > 3) invalid("At most three audio calls per run");
      emit({ type: "tool", name: "process_audio", status: "processing" });
      const job = await ensureAudio(db, p.id, {...input,...(!input.context&&audioContext?{context:audioContext}:{})}),
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
      return stageAudio(current,input.context??audioContext??{expected_version:p.version,track_id:null,clip_id:null,start_beat:0,offset_seconds:0});
    },
    { project_id: p.id, accepted_version: p.version },
  );
  const provider = createOpenAI({
    apiKey: config.llmKey,
    baseURL: config.llmURL || undefined,
  });
  const model =
    modelOverride ??
    provider.chat(selectedModel ?? config.producerModel);
  // Import visible historical replies, never assume Python harness checkpoints are SDK messages.
  const history: ModelMessage[] = [];
  for (const prior of db
    .all<RunRow>(
      "SELECT * FROM producer_runs WHERE project_id=? AND status='complete' AND (applied=1 OR json_array_length(commands)=0) ORDER BY created_at",
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
            mode?: string;
          },
      );
    const reply =
      events.findLast((e) => e.type === "reply")?.text ??
      events
        .filter((e) => e.type === "text")
        .map((e) => e.delta ?? "")
        .join("");
    if(!reply&&events.some(e=>e.type==='input'&&e.mode==='realtime'))continue;
    if(prior.prompt)history.push({role:'user',content:prior.prompt});
    history.push({role:'assistant',content:reply||'Edit proposal reviewed.'});
  }
  const messages: ModelMessage[] = [
    ...history,
    {
      role: "user",
      content:
        `Accepted project version: ${p.version} (staged edits do not change this version).\nProject data:\n` +
        JSON.stringify(JSON.parse(p.document)) +
        (audioContext ? '\nSelected musical context:\n'+JSON.stringify(selectedAudioReference(db,p.id,audioContext)) : target ? '\nSelected musical target:\n'+JSON.stringify(target) : '') +
        "\nUser:\n" +
        prompt,
    },
  ];
  let recordingArmed=false;
  let fileOperation=false,controlVersion=p.version;
  const yue2App = config.yue2.app;
  const scoreGenerations = new Map<string, Promise<unknown>>();
  const songRenders = new Map<string, Promise<unknown>>();
  let controlQueue:Promise<unknown>=Promise.resolve();
  const control=(input:StudioAction)=>{
    const execution=controlQueue.catch(()=>{}).then(async()=>{
    if((input.action==='prepare_recording'||input.action==='save'||input.action==='export')&&session.commands.length)invalid('Finish project edits before recording or file operations.');
    if(recordingArmed&&input.action!=='stop')invalid('Recording is already armed. Finish your preparation reply.');
    const result=await requestStudioControl(db,p.id,runId!,clientId!,controlVersion,input,emit,signal);
    if(input.action==='prepare_recording')recordingArmed=true;
    if(input.action==='stop')recordingArmed=false;
    if(input.action==='save'||input.action==='export')fileOperation=true;
    if(result.version)controlVersion=result.version;
    return result;
    });
    controlQueue=execution;return execution;
  };
  const tools = {
    ...(runId&&clientId?{
      control_studio:tool({description:'Control the initiating browser metronome, playback or stop, with real acknowledgement. Recording uses record_audio, whose destination and range are mandatory.',inputSchema:transportActionSchema,execute:control}),
      record_audio:tool({description:'Record the user humming/singing into an agreed project location, automatically stopping at end_beat. All parameters are mandatory: clarify unresolved segment, destination, start and end with the user first; do not guess. No application click is needed. Choose dry accompaniment=false for humming. Success means armed: finish with a short cue and wait for the later verified recording result before transcription or edits.',inputSchema:recordingPlanSchema,execute:plan=>control({action:'prepare_recording',plan})}),
      save_project:tool({description:'Explicitly save the current editing draft, or Save as with a name, using the existing file workflow. Use Save as for an example/new draft. Wait for actual save completion; do not stage content edits in this run.',inputSchema:savePlanSchema,execute:plan=>control({action:'save',plan})}),
      export_audio:tool({description:'Export the accepted song mix as WAV through the owning browser and shared media store. Use only when requested; wait for actual completion. Does not Save the project.',inputSchema:z.strictObject({}),execute:()=>control({action:'export'})}),
    }:{}),
    ...session.tools,
    ...(yue2App ? {
      generate_score: tool({
        description: 'YuE2 Plan for explicit score-only requests, such as editable notes without song audio. Supply a short musical style and original or user-provided lyrics with section tags. The tool stages both melodies, harmony and section markers at the requested beat. Do not restage results or retry a failed call automatically.',
        inputSchema: yue2InputSchema,
        execute: input => {
          const startBeat = input.start_beat ?? audioContext?.start_beat ?? 0;
          const key = JSON.stringify({ ...input, start_beat: startBeat });
          const existing = scoreGenerations.get(key);
          if (existing) return existing;
          const generation = (async () => {
            if (recordingArmed || fileOperation) invalid('Finish the current studio operation before generating a score.');
            emit({ type: 'tool', name: 'generate_score', status: 'processing' });
            let score: Awaited<ReturnType<typeof planYue2Score>>;
            try {
              score = await planYue2Score(yue2App, input, signal);
            } catch (error) {
              signal.throwIfAborted();
              emit({ type: 'tool', name: 'generate_score', status: 'rejected' });
              return {
                status: 'failed',
                error: error instanceof z.ZodError
                  ? 'The YuE2 score could not be imported because it failed validation.'
                  : 'The YuE2 score request could not be completed.',
              };
            }
            signal.throwIfAborted();
            const result = session.propose(yue2ScoreCommands(score, input, startBeat, session.getDocument()));
            return {
              status: result.status,
              start_beat: startBeat,
              duration_beats: score.duration_beats,
              score_bpm: score.bpm,
              score_meter: score.meter,
              key_changes: score.keys,
              sections_relative_to_clip: score.sections,
              project_bpm: result.project_summary.tempo,
              project_meter: result.project_summary.time_signature,
              vocal_notes: score.vocal.length,
              instrumental_notes: score.instrumental.length,
              chords_relative_to_clip: score.chords,
            };
          })();
          scoreGenerations.set(key, generation);
          return generation;
        },
      }),
      render_yue2_song: tool({
        description: 'Default tool for new composition and substantial arrangement. YuE2 Render stages the full stereo mix and editable melody Clips from the same rendered ABC, including harmony and sections. Melody tracks are initially muted so the stereo mix can play on its own. Set audio_only only for an explicit stereo-only request. Reuse prior style, lyrics and seed for the same song. Uses the generation inputs, so edits made to project notes are not included. Do not restage results or resubmit a failed render automatically.',
        inputSchema: yue2InputSchema.extend({ audio_only: z.boolean().default(false) }),
        execute: input => {
          const startBeat = input.start_beat ?? audioContext?.start_beat ?? 0;
          const key = JSON.stringify({ ...input, start_beat: startBeat });
          const existing = songRenders.get(key);
          if (existing) return existing;
          const render = (async () => {
            if (recordingArmed || fileOperation) invalid('Finish the current studio operation before rendering a song.');
            emit({ type: 'tool', name: 'render_yue2_song', status: 'processing' });
            try {
              const arrangement = input.audio_only ? undefined : await renderYue2Arrangement(yue2App, input, signal);
              const song = arrangement?.song ?? await renderYue2Song(yue2App, input, signal);
              const document = session.getDocument();
              const scoreCommands = arrangement
                ? yue2ScoreCommands(arrangement.score, input, startBeat, document, true)
                : [];
              const tempoEdit = scoreCommands.find(command => command.type === 'project.set_tempo');
              const tempo = tempoEdit?.tempo ?? document.tempo;
              const mixName = arrangement ? `${input.name} · YuE2 Mix` : input.name;
              const asset = await prepareAsset(p.id, `${mixName}.flac`, 'audio/flac', song.audio_flac, 'sample', newId(), signal);
              signal.throwIfAborted();
              const trackId = newId();
              const source = sourceSchema.parse({
                id: asset.id, name: mixName, kind: 'audio', asset_id: asset.id, duration: song.audio_seconds,
              });
              const result = db.tx(() => {
                publishAsset(db, asset);
                return session.propose([
                  ...scoreCommands,
                  { type: 'source.add', source },
                  { type: 'track.add', id: trackId, name: mixName, kind: 'audio' },
                  { type: 'clip.add', id: newId(), track_id: trackId, name: mixName, kind: 'audio',
                    source_id: source.id, start_beat: startBeat,
                    length_beats: song.audio_seconds * tempo / 60,
                    source_duration: song.audio_seconds },
                ]);
              });
              return {
                status: result.status, seconds: song.audio_seconds, truncated: song.truncated,
                ...(arrangement ? {
                  editable_score: true, note_tracks_muted: true, score_bpm: arrangement.score.bpm,
                  vocal_notes: arrangement.score.vocal.length, instrumental_notes: arrangement.score.instrumental.length,
                  chord_symbols: arrangement.score.chords.length,
                } : {}),
              };
            } catch (error) {
              signal.throwIfAborted();
              emit({ type: 'tool', name: 'render_yue2_song', status: 'rejected' });
              return { status: 'failed', error: error instanceof ApiError ? error.message : 'YuE2 audio could not be rendered or imported.' };
            }
          })();
          songRenders.set(key, render);
          return render;
        },
      }),
    } : {}),
    ...(runId?{render_clip:tool({description:'Faithfully render the selected accepted Clip/current instrument into Sound in the browser. Optional sound chooses a built-in instrument for note Clips without changing the original. For AI style variations set reference_only=true to avoid placing an intermediate render, then use the returned reference_source_id in process_audio.reference after rendering; generated variations are not exact MIDI rendering.',inputSchema:z.object({context:audioContextSchema.optional(),name:z.string().min(1).max(80).default('Rendered Sound'),reference_only:z.boolean().default(false),sound:z.enum(SOUND_IDS).optional()}),execute:async input=>{const context=input.context??audioContext;if(!context)invalid('Select a Clip or provide its context before rendering');const job=await requestBrowserRender(db,p.id,runId,{...input,context},emit,signal);if(input.reference_only){const source=(JSON.parse(job.results) as AudioResult[])[0].source;return {job_id:job.id,source,reference_source_id:source?.id,status:'reference_ready'};}return stageAudio(job,context);}})}:{}),
    list_audio_models: tool({description:'List available music, speech, effects and analysis capabilities. Choose a ready model and its supported voice before process_audio. Music generation does not guarantee note preservation.',inputSchema:z.object({}),execute:async()=>({models:await audioCapabilities()})}),
    ...vocalTools(db, p.id, emit),
    ...((audioReady() || config.elevenlabsKey || analysisReady()) && session.audioTool
      ? { process_audio: session.audioTool }
      : {}),
  };
  const result = streamText({
    model,
    system: instructions+(voice?' This is a spoken conversation. Reply briefly in natural speech, without Markdown or internal IDs. Describe changes honestly; edits apply automatically and can be undone.':''),
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
  if((recordingArmed||fileOperation)&&session.commands.length)invalid('Recording preparation and file operations cannot also stage project edits. Request edits separately.');
  emit({ type: "reply", text: reply });
  return {
    commands: session.commands,
    state: {
      format: "ai-sdk-v1",
      messages: [...messages, ...(await result.responseMessages)],
    },
  };
}
export async function continueRecordedProducer(db:Store,project:string,run:string,input:unknown,modelOverride?:LanguageModel){
  const body=z.strictObject({request_id:z.string().min(1).max(100),client_id:z.string().min(1).max(100)}).parse(input);
  const recording=recordingContinuation(db,project,run,body.request_id,body.client_id),id=`recording-followup-${body.request_id}`;
  const existing=db.get<RunRow>('SELECT * FROM producer_runs WHERE id=? AND project_id=?',id,project);
  if(existing)return {id:existing.id,status:existing.status};
  const modelEvent=db.get<{payload:string}>("SELECT payload FROM producer_events WHERE run_id=? AND json_extract(payload,'$.type')='model' ORDER BY seq LIMIT 1",run);
  const model=modelEvent?JSON.parse(modelEvent.payload).model:undefined;
  return startProducer(db,project,{id,text:recordingContinuationPrompt(recording),expected_version:recording.version,context:recording.context,client_id:body.client_id,model},modelOverride,true);
}
export async function startProducer(
  db: Store,
  projectId: string,
  input: unknown,
  modelOverride?: LanguageModel,
  applicationRecording=false,
) {
  const request = z
    .object({
      id: z.string().min(1).max(100),
      text: z.string().min(1).max(4000),
      expected_version: z.number().int().min(1),
      context: audioContextSchema.optional(),
      model: z.string().refine(id=>producerModelChoices().some(m=>m.id===id),'Select an available Producer model').optional(),
      voice: z.boolean().default(false),
      client_id:z.string().min(1).max(100).optional(),
    })
    .parse(input);
  const selectedModel=request.model??config.producerModel;
  const result = db.tx(() => {
    const p = getProject(db, projectId),
      existing = db.get<RunRow>(
        "SELECT * FROM producer_runs WHERE id=?",
        request.id,
      );
    if (existing) {
      const contextEvent=db.get<EventRow>("SELECT payload FROM producer_events WHERE run_id=? AND json_extract(payload,'$.type')='context' ORDER BY seq LIMIT 1",request.id)
      const capturedContext=contextEvent?JSON.parse(contextEvent.payload).context:undefined
      const modelEvent=db.get<EventRow>("SELECT payload FROM producer_events WHERE run_id=? AND json_extract(payload,'$.type')='model' ORDER BY seq LIMIT 1",request.id)
      const capturedModel=modelEvent?JSON.parse(modelEvent.payload).model:undefined
      const browserEvent=db.get<EventRow>("SELECT payload FROM producer_events WHERE run_id=? AND json_extract(payload,'$.type')='browser' ORDER BY seq LIMIT 1",request.id)
      const capturedBrowser=browserEvent?JSON.parse(browserEvent.payload).client_id:undefined
      if (
        existing.project_id !== projectId ||
        existing.prompt !== request.text ||
        existing.base_version !== request.expected_version ||
        JSON.stringify(capturedContext)!==JSON.stringify(request.context) ||
        capturedBrowser!==request.client_id ||
        (request.model!==undefined&&capturedModel!==selectedModel)
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
    if(request.context)validateAudioContext(db,projectId,request.context);
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
    if(request.context)append(db,request.id,{type:'context',context:request.context});
    append(db,request.id,{type:'model',model:selectedModel});
    if(request.client_id)append(db,request.id,{type:'browser',client_id:request.client_id});
    if(request.voice)append(db,request.id,{type:'input',mode:'voice'});
    if(applicationRecording)append(db,request.id,{type:'input',mode:'recording_result'});
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
          request.context ? producerTargetSchema.parse(Object.fromEntries(Object.entries(request.context).filter(([,v])=>v!=null))) : undefined,
          request.context,
          selectedModel,
          request.voice,
          request.id,
          request.client_id,
        );
        signal.throwIfAborted();
          db.run(
            "UPDATE producer_runs SET commands=?,state=? WHERE id=? AND status='running'",
            JSON.stringify(output.commands),
            JSON.stringify(output.state),
            request.id,
          );
          if(output.commands.length){
            try{
              applyCommands(db,projectId,{request_id:`producer-${sha256Text(request.id)}`,expected_version:request.expected_version,commands:output.commands},true);
              db.run('UPDATE producer_runs SET applied=1 WHERE id=?',request.id);
              append(db,request.id,{type:'activity',status:'applied',target:request.context??{},text:'Changes applied'});
            }catch(error){
              append(db,request.id,{type:'error',text:error instanceof ApiError?error.message:'Changes could not be applied. Ask Producer to try again with the current project.'});
            }
          }
          db.tx(()=>{
            db.run("UPDATE producer_runs SET status='complete' WHERE id=?",request.id);
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
