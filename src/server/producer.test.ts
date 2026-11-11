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
  commandTargets,
  producerHistory,
} from "./producer";
import { documentSchema } from "@/shared/schema";
import { config } from './config';
import * as audioJobs from './audio-jobs';
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
it('sends Producer chat through the shared OpenRouter connection', async () => {
  const old = { key: config.llmKey, url: config.llmURL, model: config.producerModel };
  config.llmKey = 'shared-test-key'; config.llmURL = 'https://openrouter.ai/api/v1'; config.producerModel = 'openai/test-model';
  const send = vi.fn(async () => new Response('data: '+JSON.stringify({ id:'test', object:'chat.completion.chunk', created:1, model:config.producerModel, choices:[{index:0,delta:{role:'assistant',content:'Connected'},finish_reason:null}] })+'\n\ndata: '+JSON.stringify({ id:'test', object:'chat.completion.chunk', created:1, model:config.producerModel, choices:[{index:0,delta:{},finish_reason:'stop'}] })+'\n\ndata: [DONE]\n\n', {headers:{'Content-Type':'text/event-stream'}}));
  vi.stubGlobal('fetch', send);
  try {
    const events: Record<string, unknown>[] = [];
    await produce(db, createProject(db,'Connection test',{},true), 'Reply briefly.', AbortSignal.timeout(5000), e=>events.push(e));
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(config.llmURL+'/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer shared-test-key');
    expect(JSON.parse(String(init.body)).model).toBe('openai/test-model');
    expect(events).toContainEqual({type:'reply',text:'Connected'});
  } finally { config.llmKey=old.key; config.llmURL=old.url; config.producerModel=old.model; vi.unstubAllGlobals(); }
});
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
it('reports changed note identities without inventing unrelated targets',()=>{
  const before=documentSchema.parse({sources:[{id:'s',kind:'notes',name:'Score',duration:4,notes:[{id:'a',pitch:60,start:0,duration:1,velocity:0.8},{id:'b',pitch:64,start:2,duration:1,velocity:0.8}]}]});
  const notes=before.sources[0].notes.map(n=>n.id==='b'?{...n,pitch:65}:n);
  expect(commandTargets([{type:'source.update',source_id:'s',notes}],before)).toEqual([{source_id:'s',note_ids:['b']}]);
  const events:Record<string,unknown>[]=[];
  const session=createProducerTools(before,e=>events.push(e));session.propose([{type:'source.update',source_id:'s',notes}]);
  expect(events).toContainEqual(expect.objectContaining({type:'activity',status:'proposed',target:{source_id:'s',note_ids:['b']}}));
  expect(before.sources[0].notes[1].pitch).toBe(64);
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
it('lets the agent discover and invoke audio tools while carrying selected references',async()=>{
  const p=createProject(db,'Referenced',{},true),oldKey=config.elevenlabsKey;config.elevenlabsKey='tool-test';
  const context={expected_version:p.version,track_id:null,clip_id:null,start_beat:8,offset_seconds:0};
  const catalog=vi.spyOn(audioJobs,'audioCapabilities').mockResolvedValue([]);
  const ensure=vi.spyOn(audioJobs,'ensureAudio').mockResolvedValue({id:'audio',project_id:p.id,status:'complete',request:'{}',upstream_id:null,results:'[]',error:null,created_at:''});
  const mock=model([
    [{type:'tool-call',toolCallId:'catalog',toolName:'list_audio_models',input:'{}'},finish('tool-calls')],
    [{type:'tool-call',toolCallId:'audio',toolName:'process_audio',input:JSON.stringify({mode:'speech',model:'elevenlabs/test',prompt:'Hello',voice:'voice'})},finish('tool-calls')],
    [{type:'text-start',id:'reply'},{type:'text-delta',id:'reply',delta:'Audio prepared.'},{type:'text-end',id:'reply'},finish('stop')],
  ]);
  try{
    await produce(db,p,'Read this aloud.',AbortSignal.timeout(5000),()=>{},mock,undefined,context);
    expect(catalog).toHaveBeenCalledTimes(1);expect(ensure).toHaveBeenCalledWith(db,p.id,expect.objectContaining({mode:'speech',model:'elevenlabs/test',context}));
    expect(JSON.stringify(mock.doStreamCalls[0].prompt)).toContain('Selected musical context');
  }finally{catalog.mockRestore();ensure.mockRestore();config.elevenlabsKey=oldKey}
});
it('persists selected source/note references with the conversation',async()=>{
  const p=createProject(db,'Referenced',{sources:[{id:'s',kind:'notes',name:'Notes',duration:4,notes:[{id:'n',pitch:60,start:0,duration:1,velocity:0.8}]}]},true);
  const context={expected_version:p.version,track_id:null,clip_id:null,start_beat:0,offset_seconds:0,source_id:'s',note_ids:['n']};
  const mock=model([[{type:'text-start',id:'r'},{type:'text-delta',id:'r',delta:'Selected note inspected.'},{type:'text-end',id:'r'},finish('stop')]]);
  await startProducer(db,p.id,{id:'reference-run',text:'Make this longer.',expected_version:p.version,context},mock);
  await vi.waitFor(()=>expect(requireRun(db,p.id,'reference-run').status).toBe('complete'));
  const history=audioJobs.validateAudioContext(db,p.id,context);expect(history.sources[0].id).toBe('s');
  const events=db.all<{payload:string}>('SELECT payload FROM producer_events WHERE run_id=?','reference-run').map(e=>JSON.parse(e.payload));
  expect(events.find(e=>e.type==='context')?.context).toEqual(context);
  await expect(startProducer(db,p.id,{id:'reference-run',text:'Make this longer.',expected_version:p.version,context:{...context,note_ids:[]}},mock)).rejects.toThrow('Run ID already used');
  expect(()=>audioJobs.validateAudioContext(db,p.id,{...context,note_ids:['deleted']})).toThrow('Referenced notes');
});
it('offers DeepSeek Flash and rejects unlisted model selection before starting a run',async()=>{
  const p=createProject(db,'Model choice',{},true),history=producerHistory(db,p.id);
  expect(history.models).toContainEqual({id:'deepseek/deepseek-v4.1-flash',name:'DeepSeek Flash'});
  await expect(startProducer(db,p.id,{id:'bad-model',text:'Hello',expected_version:p.version,model:'unlisted/model'})).rejects.toThrow('Select an available Producer model');
  expect(db.get('SELECT id FROM producer_runs WHERE id=?','bad-model')).toBeUndefined();
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

it('automatically applies a completed Producer batch once and supports normal undo',async()=>{
 const {undo}=await import('./projects');
 const p=createProject(db,'Auto apply',{},true),mock=model([[{type:'tool-call',toolCallId:'tempo',toolName:'propose_edits',input:JSON.stringify({edits:[{type:'project.set_tempo',tempo:96}]})},finish('tool-calls')],[finish('stop')]]);
 const request={id:'automatic',text:'Set tempo',expected_version:1};
 await startProducer(db,p.id,request,mock);
 await vi.waitFor(()=>expect(requireRun(db,p.id,request.id).status).toBe('complete'));
 expect(requireRun(db,p.id,request.id).applied).toBe(1);expect(getProject(db,p.id).version).toBe(2);
 expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(96);
 await startProducer(db,p.id,request,mock);expect(getProject(db,p.id).version).toBe(2);
 undo(db,p.id,2);expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(120);
});
it.skipIf(process.env.DEMOTIF_LIVE_YUE2_TEST !== '1')(
  'imports a live YuE2 score as editable Clips in one undoable Producer batch',
  async () => {
    const { undo } = await import('./projects');
    const project = createProject(db, 'YuE2 score test', {}, true);
    const input = {
      name: 'Blue Night',
      style: 'Japanese J-pop in Japanese, bright female lead vocal, 120 BPM, 4/4, major key, bright piano and clean electric guitar, live pop drums, melodic bass, bittersweet city-at-night mood, short verse and soaring chorus, clean ending.',
      lyrics: '[Verse]\n終電の窓に　街がにじむ\nポケットの中　君のメモ\n明日になれば　言えるかな\n小さな声で　名前を呼ぶ\n\n[Chorus]\n青い夜を越えてゆこう\nふたりの朝を迎えにゆこう\n消えそうな星を胸に抱いて\n君のとなりで　もう一度',
      start_beat: 8,
    };
    const agent = model([
      [{ type: 'tool-call', toolCallId: 'score', toolName: 'generate_score', input: JSON.stringify(input) }, finish('tool-calls')],
      [finish('stop')],
    ]);
    const run = { id: 'yu-e-score', text: 'Compose editable J-pop melodies.', expected_version: project.version };
    await startProducer(db, project.id, run, agent);
    await vi.waitFor(() => expect(requireRun(db, project.id, run.id).status).toBe('complete'), { timeout: 180_000 });
    expect(requireRun(db, project.id, run.id).applied).toBe(1);
    const saved = getProject(db, project.id);
    const document = documentSchema.parse(JSON.parse(saved.document));
    expect(saved.version).toBe(project.version + 1);
    expect(document.tempo).toBe(120);
    expect(document.tracks).toHaveLength(2);
    expect(document.sources.length).toBeGreaterThan(1);
    expect(document.tracks.every(track => track.clips.length > 1)).toBe(true);
    expect(document.tracks.flatMap(track => track.clips).every(clip => clip.start_beat >= 8)).toBe(true);
    expect(document.sources.every(source => source.kind === 'notes' && source.notes.length > 0)).toBe(true);
    expect(document.abc_imports).toHaveLength(1);
    expect(document.abc_imports?.[0]).toMatchObject({
      start_beat: 8, lyrics: input.lyrics, score: { abc: expect.stringContaining('X:1'), bars: expect.any(Array) },
    });
    undo(db, project.id, saved.version);
    expect(documentSchema.parse(JSON.parse(getProject(db, project.id).document)).tracks).toEqual([]);
    expect(documentSchema.parse(JSON.parse(getProject(db, project.id).document)).abc_imports).toBeUndefined();
  },
  190_000,
);
it('retains completed commands when a concurrent edit prevents automatic application',async()=>{
 const {applyCommands}=await import('./projects');
 const p=createProject(db,'Conflict',{},true);
 const mock=model([[{type:'tool-call',toolCallId:'tempo',toolName:'propose_edits',input:JSON.stringify({edits:[{type:'project.set_tempo',tempo:96}]})},finish('tool-calls')],[finish('stop')]]);
 await startProducer(db,p.id,{id:'conflict-auto',text:'Set tempo',expected_version:1},mock);
 applyCommands(db,p.id,{expected_version:1,commands:[{type:'project.set_tempo',tempo:110}]});
 await vi.waitFor(()=>expect(requireRun(db,p.id,'conflict-auto').status).toBe('complete'));
 expect(requireRun(db,p.id,'conflict-auto').applied).toBe(0);
 expect(JSON.parse(requireRun(db,p.id,'conflict-auto').commands)).toHaveLength(1);
 expect(JSON.parse(getProject(db,p.id).document).tempo).toBe(110);
 expect(producerHistory(db,p.id).runs[0].events.some(e=>e.type==='error')).toBe(true);
});
