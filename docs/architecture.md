# Demotif architecture

Demotif is a Next.js full-stack music workspace with one SQLite-owning backend and optional API-proxy frontends. The browser owns audio; the Node runtime owns accepted
project state, saves, history, media access, and optional producer/provider execution. No Python HTTP service runs.

## Runtime boundaries

```text
Browser: React studio + Web Audio + two lazy Workers
   │  typed JSON commands / uploads / resumable SSE
   ▼
Next.js App Router UI + Node API routes (persistent local process)
   ├─ shared Zod contracts and validated project services
   ├─ SQLite transactions, append-only operations, editing drafts
   ├─ private S3 binaries, SQLite catalog metadata and disposable caches
   ├─ Vercel AI SDK producer and staged tools
   └─ durable audio-provider jobs / optional analysis subprocess
        │
        ▼
SQLite on a persistent local volume + private S3; optional providers
```

Realtime playback, seeking, audition, clip loops, effects, and OfflineAudioContext WAV export remain browser-local.
No remote stream or render queue sits in the transport path. The same DSP/graph serves playback and export.
Generation and analysis are distinct provider operations whose results require explicit accepted commands.

## Layout and commands

- `src/app/`: App Router UI, root layout and client workspace boundary.
- `src/pages/api/`: Node API route adapter, preserving explicit HEAD/Range content lengths and streaming bodies.
- `src/shared/schema.ts`: runtime Zod document/command validation; frontend types derive from these schemas.
- `src/server/`: project services, SQLite adapter, reversible deltas, media, examples, producer, audio jobs.
- `src/features/`, `components/`: studio, project management, libraries and shared shadcn/Base UI.
- `src/audio/`: existing browser DSP, Worker scheduling, loading, graph, effects, export and adapter.
- `resources/`: built-in sound catalog, WAV files, provenance and licenses.
- `analysis/`: optional isolated Python/librosa transcription command and tests; no web framework or agent harness.
- `data/`: ignored SQLite, media and local examples. Legacy local files are archived outside the checkout as rollback material.
- `scripts/migrate-local-data.mjs`: non-destructive copy of legacy local state and ignored configuration.

Node.js 24+ supplies `node:sqlite`; no native npm database addon is needed. Install with `npm ci`.
`npm run dev` serves UI and API on 5173. `npm run build`, `npm start`, `npm test`, and `npm run typecheck` run
directly from the repository root. Vitest tests the browser engine and Node services. Optional analysis uses `uv sync --project analysis`.

The application is intended for a persistent local Node process. It requires a writable local filesystem and is not
ready for ephemeral/serverless deployment or multiple independent API replicas. There is no authentication boundary yet.

## Project authority and history

The persisted document contains tempo, meter, key, sections, Sources, reusable Parts (a compatible protocol identifier),
Tracks, placed Clips, and mixer/master/bus settings. UI calls them Clips. Notes/arrangement/automation use quarter-note
beats; recorded source windows use seconds. Tempo supports 20–300 BPM to one decimal place.

Every command is runtime-validated. Expected versions are checked under an immediate SQLite transaction; updates use
compare-and-swap and write a new version plus operation deltas atomically. Shared-source edits check all referencing
locked tracks/clips. Mixer routes reject cycles. Media IDs must belong to the current project. Batch request receipts
recover identical requests and reject reused identities with different content. Legacy Python request fingerprints
are recognized so migration does not replay accepted edits or create duplicate paid audio submissions.

Operations store forward/inverse field changes and stable-ID entity inserts/removes/moves. Value arrays use replacement
deltas. Undo applies the latest uncompensated inverse and appends a new compensation version; it never deletes history.
Legacy Revision rows are read-only. Databases still using snapshot history are validated and converted transactionally;
incomplete or inconsistent history aborts initialization. Lock payload size is independent of unrelated project content,
but validation/diffing/document persistence still process project state.

Tables: `projects`, `operations`, legacy `revisions`, `assets`, `command_receipts`, `producer_runs`, `producer_events`,
and `audio_jobs`. The new adapter preserves the existing table/JSON layout and IDs. Database access stays behind Store;
a future hosted SQL implementation and object-storage adapter remain separate work.

## Drafts and explicit saves

Opening a saved project creates an isolated server draft with a base ID and version. Examples open as clean unlisted
drafts without a saved base. Drafts use the same validated commands, locks, asset ownership and undo protocol, and never
appear in project listings/recents. Accepted name/document is compared with an opening/save checkpoint; undo can return
the draft to a clean state.

Save publishes a draft to its base with a version check, rejecting concurrent-tab overwrites. Save as creates a new saved
project and changes the draft's base. Examples require Save as until copied. Media metadata is cloned for ownership while
immutable blob keys are retained. Saving advances a baseline operation and checkpoint without rewriting prior history.
Conflicts and failures retain the editable draft and departure protection.

Navigation uses Next route entry points and document navigation. Home/project links use a shared unsaved-changes dialog,
because embedded browsers may silently cancel native departure dialogs. Cancellation retains the workspace; confirmation
removes the beforeunload handler for that departure to avoid a second prompt. Refresh, tab closure and browser Back retain
native `beforeunload` protection where the browser supports it. Dirty checks cover accepted unsaved edits, pending
operations/uploads/saves, and uncommitted inputs. Clean saved-project-to-draft redirects replace the document URL.
The studio remains a browser-only client boundary so AudioContext, Workers, matchMedia and local theme state are never
executed during server prerendering. Existing studio layout, motion and editing geometry are retained.

## Producer and asynchronous jobs

The TypeScript producer uses Vercel AI SDK with the configured Chat Completions or Responses-compatible model route.
It exposes only project inspection, installed sounds, typed staged edits and available audio operations. There are no
shell/filesystem tools. Edits are validated on a private document; accepted state changes only on explicit proposal Apply.
Limits bound steps, proposal size, elapsed time and audio calls. Visible text/tool events persist with increasing SSE
sequence numbers. Historical replies remain readable; old Python harness state is never mistaken for SDK message history.

Producer runs live independently of an individual SSE connection. Refresh/reconnect resumes durable display events;
cancellation aborts model work. Startup marks unfinished local runs interrupted. Execution is in the persistent Node
process with bounded slots, matching the current local deployment; an external durable worker/lease service would be
required before horizontal scaling or serverless deployment.

Audio jobs preserve intent and upstream IDs before polling/materializing results. Identical request/take fingerprints
recover existing jobs. An unknown paid submission is never automatically resubmitted. A known upstream job can be
explicitly resumed after restart; cancelled/late work cannot publish completed results. HTTPS downloads require public
addresses, pin DNS during connection, revalidate redirects, and bound bytes/time. The Modal media worker passes received audio bytes to FFmpeg through files and pipes inside its container.
Optional transcription invokes the bounded `analysis/transcribe.py` subprocess and keeps original recordings intact.

## Storage and migration

Server-only `.env.local` configures providers and optional storage paths. Relative paths resolve from repository root;
defaults are `data/demotif.db`, `data/media/`, `data/examples/`. No credential uses a NEXT_PUBLIC prefix.

Stop the old API, then run `npm run migrate:local`. SQLite's backup API copies the database consistently; media/examples
are copied without overwriting existing destination files. Original local files and configuration are retained. The Node
adapter also creates a pre-Next.js SQLite backup before initialization. For rollback, stop Next.js and use the retained
legacy code/state consistently; do not combine two writers. Do not overwrite an existing destination database automatically.
There is no general Python backend, genre shader or automatic project save.

## Deferred work

Microphone capture/count-in, latency compensation, live pitch correction, multi-user access, hosted storage/database,
and adaptive studio atmospheres remain separate work. Playback/export does not depend on provider availability.

## Optional native singing

`workers/singing/` is a Python 3.11/PyTorch inference package, separate from the optional analysis environment. Next.js `src/server/vocals/` writes immutable accepted-score snapshots, runs one lazy warm JSON Lines child and publishes validated PCM into the existing owned media store. SQLite persists requests, deduplicated phrase jobs and source bindings. Active cancellation terminates the child; a later request lazily starts it again. Startup marks unfinished inference interrupted and dispatches queued work. No public Python API, Redis or generic backend app is introduced.

Vocal sources preserve notes, syllables/continuations, pronunciation, pitch/volume curves and vibrato as typed versioned score data. Derived completion neither increments the score version nor saves the draft. Fingerprints include musical inputs, tempo, model/config/dictionary hashes, pinned runtime, compiler, backend, precision, seed and full-quality sampling settings. Late output remains cached but cannot become current for changed music. Save/Save as remaps derived asset ownership while retaining immutable blobs.

Browser preparation resolves matching phrase assets and assembles them using their explicit source-time offsets. Playback, seeking, clip loops and mix export continue through Web Audio. Arrangement playback with missing/stale vocal audio requires synthesis or explicitly muting the vocal track. The clip-loop action prepares the current source on demand and starts only after matching audio is ready; stopping/closing it cancels requests created by that playback action without cancelling an independently started synthesis. Export prepares full-quality audio against its captured accepted score; version conflicts or inference errors prevent incomplete downloads. Newly ready audio is adopted at the next playback/loop preparation, never injected into a running graph.

The local reference profile is OpenCpop from OpenVPI DiffSinger v1.5.0 with its matching native NSF-HiFiGAN vocoder. It is a user-approved non-commercial Demo, not a production/hosted voice license. Weights stay under ignored `data/models/`; source and terms are documented in `docs/vocal-model-screening.md`. This older profile uses scored F0 and manual/deterministic initial phoneme timing, not a separate automatic tuning predictor. See `workers/singing/README.md` for installation, tests and rollback.

Vocal note editing uses a centered modal dialog. Note-local lyric entry keeps all entered syllables inside the selected note by default, preserving geometry and following assignments. No placement-mode selector or following-note overflow is shown. Optional legacy mode metadata remains readable, and unmarked multiword assignments compile identically. The compiler expands the phrase into dictionary syllables, divides the original note's time into initial equal syllable budgets, and extends only the last syllable over following continuation notes. Consonant/vowel timing defaults remain deterministic, not predicted. An explicit equal-note Split action commits notes and lyrics atomically; the whole-clip Lyrics dialog retains bulk assignment and existing grouping. Pronunciation and phonemes participate in existing render fingerprints and save/undo semantics. Piano and drum editors delete on right-click; duration editing snaps to the quarter-beat grid while readouts use at most two decimals and imported timing stays intact until edited.

## Guided vocal reference recording

Vocal editors open a focused browser recording dialog. An AudioWorklet captures mono microphone PCM on an absolute sample-frame clock; the same AudioContext drives score lyric cues and a one-bar count-in. Count-in output and microphone capture are separate, with no microphone monitoring. Completed takes release the microphone and remain local for audition, re-record and WAV download until explicitly uploaded.

Save reference uses the existing media API with reference kind and one idempotent versioned command batch to add the audio source, library entry and muted placement. Optional reference_recording source metadata retains the original score cue snapshot, tempo/meter, source origin and captured sample-frame context. These remain editing-draft changes until normal Save/Save as. Existing documents require no database migration. Offline alignment/expression extraction is separate future work; this feature does not alter native singing inference. See [vocal-recording.md](vocal-recording.md).

## Shared workspace storage

SQLite stores the current project document, independent drafts, save checkpoints, forward/inverse operation deltas, receipts, conversations/events, durable jobs, catalog metadata and export records. Ordinary edits do not write full snapshots or contact S3. There is no project file format.

S3 stores immutable hash-addressed binary objects: uploads, recordings, generated audio, native voice resources, built-in/example audio and exported mixes. Uploads verify actual bytes before a short SQLite transaction publishes ownership and bindings. Failed database commits leave unreferenced objects; no automatic deletion is performed. API routes validate ownership and issue short-lived exact-object STS sessions; browsers perform authenticated S3 reads and writes directly. COS serves HEAD/Range/conditional requests. Native model/analysis files are verified disposable materializations.

Object storage uses the storage endpoint/bucket/region/prefix in demotif.config.json and the two server-only S3 credential variables. Endpoint may be the service or virtual-hosted bucket HTTPS URL.

A frontend-only runtime explicitly selects proxy mode and an upstream URL in demotif.config.json. It forwards all API calls before opening local SQLite/workers, with no fallback. Only one backend owns SQLite.

Run npm run build:storage to compile the operator utility, then node --env-file=/private/storage.env .storage/storage.mjs verify. The utility supports inventory <db>, migrate <db>, catalogs <db> and import <target.db> <immutable-source.db> <source-identity>. Create consistent SQLite backups first, stop writers for final import/cutover and retain original media/database backups. Migration verifies S3 bytes before updating asset keys; re-running verifies completed objects. Import runs atomically, records source provenance, preserves divergent ID graphs and refuses a changed source under the same import identity. Inspect count/hash/history reports before activation; private deployments and credentials are intentionally excluded from repository documentation.

The API uses Next.js Node API routes with its body parser disabled and the shared Web Request/Response handler behind a streaming adapter. Next.js 16.4 App Route sendResponse removes Content-Length; the Node adapter retains verified media lengths. Audio and SSE responses use no-transform so compression cannot change range framing or buffer event delivery.

## Browser direct transfers

Browser uploads reserve one staging object through `/api/projects/:id/uploads`, upload directly to S3 using temporary STS credentials and Content-MD5, then POST metadata-only completion. The server checks size/ETag and conditionally copies the object within COS into a unique final path outside the upload credential scope before publishing the asset. Completion is idempotent. Export reservations also capture the accepted project version. Existing byte upload endpoints return a direct-transfer-required error.

Asset content and built-in preview endpoints now return no-store temporary sessions, not audio bodies. The browser obtains data directly from S3 and renews expired authorization; decoded-media caches continue using stable asset identities. Credentials stay in browser memory, never local storage or saved documents. Permanent keys stay on the backend. Participating browser origins require native bucket CORS for GET, HEAD and PUT and signed request headers; retain unrelated CORS rules. Worker analysis, synthesis and catalog/model materialization remain server-side object operations. No browser binary fallback through the application server is provided.


## Contextual audio adapters and Producer presentation

`src/server/audio-providers/elevenlabs.ts` owns direct ElevenLabs audio requests, dynamic TTS/voice discovery and Music/SFX/STT/isolation/alignment contracts. `audioCapabilitySchema` describes category, model, voices, loop support, format, duration bounds and readiness without credentials. Private Modal workers run native singing, audio-to-notes, probing and conversion. Node owns job state and publishes validated audio to object storage. Source processing uses immutable owned source/range snapshots. Generated audio is normalized, measured and durably published before acceptance.

`audio-jobs.ts` persists an OpenRouter model/context identity, validates output before owned S3 publication and stages typed commands for review. Local analysis uses the selected source range. Completion does not modify or save the draft.

`use-producer-controller.ts` owns a single SSE/submission/application lifecycle outside sidebar mounting. `clip-audio-actions.ts` owns direct audio actions, job history, target context and review independent of text-agent readiness. `producer-composer.tsx` renders the floating composer, review dialog and non-interactive operation cursor. Semantic target metadata is derived from validated commands/run context; proposed edits remain separate from accepted geometry. Scroll/zoom/resize resolve current target bounds, and reduced motion disables travel transitions. Pending operations and prompt input participate in the shared departure protection.

Piano-roll multi-selection is local editor state. `note-editing.ts` provides shared-delta transforms and hit testing; `part-editor.tsx` stages group movement/resize and commits one source update on release. Browser audio transport, audition and offline Clip rendering remain independent of remote provider execution.

## Server settings and model transport

`src/server/settings.ts` validates one optional server-only `demotif.config.json`; `src/server/config.ts` resolves it with six supported environment inputs and built-in defaults. Non-secret settings cover explicit API ownership, object storage, Producer model/options and native compute device. Credentials never enter this file, browser bundles or capability responses. Invalid settings report field paths without values.

`DEMOTIF_LLM_API_KEY` and `DEMOTIF_LLM_BASE_URL` authenticate the text Producer. `STEPFUN_API_KEY` and `STEPFUN_BASE_URL` independently authenticate StepAudio Realtime voice. `DEMOTIF_ELEVENLABS_API_KEY` authenticates batch music, speech and audio operations at the fixed official endpoint. Unsupported operations and removed OpenRouter audio jobs cannot be resumed; completed owned media remains playable. No credential fallback or automatic paid replay is introduced.

### Realtime voice

`scripts/server.ts` owns HTTP and WebSocket upgrades on one port. API requests use the existing raw Node adapter and its streaming/Range behavior. A separate in-process upgrade dispatcher keeps Next HMR from also consuming the voice socket. `producer-realtime.ts` authenticates upstream only on the server; proxy runtimes relay to their configured owning backend before touching local SQLite. Development bundles server code on startup; frontend HMR stays with Next. Deployments need a persistent Node process and WebSocket-capable reverse proxy, rather than an HTTP-only serverless route.

The browser's `RealtimeVoice` captures mono audio with an AudioWorklet, resamples to 24 kHz PCM16, continuously streams microphone chunks and schedules returned voice chunks on a separate audio context. VAD speech-start discards queued old speech and suppresses late chunks for interrupted responses. Project changes, hidden documents, teardown and connection failure release the microphone and playback; reconnect is explicit. This context does not schedule song playback or vocal recording.

`RealtimeProducerSession` captures version/selection at each turn and exposes one `edit_project` function to StepAudio. Musical work reuses existing Producer runs, validated commands, locks, draft application and Undo. Tool call IDs are deduplicated; interruption cancels owned pending work without reverting accepted edits. Completed transcripts use the existing conversation tables, and history merges a voice turn with its delegated run while retaining the run ID for SSE and cancellation. Missing StepFun configuration retains turn-based ElevenLabs STT/Producer/TTS; configured realtime conversation itself does not require a text-model credential or S3.

The optional `DEMOTIF_DATA_DIR` determines `demotif.db`, `media/`, `examples/` and `models/`. Standard worker paths are OS-derived. Existing deployments migrate configuration explicitly using `scripts/migrate-config.mjs`; dry runs and apply logs contain names only. Backups retain originals, conflicting paths stop conversion, and no database or media moves occur. Legacy env files are not copied by data migration.

`audio-jobs.ts` uses an explicit ElevenLabs model and accepted musical context for remote job identities. Completed media is owned and published through S3 before typed acceptance. Unknown remote outcomes cannot be resumed or resubmitted automatically. Local transcription remains bounded to the selected source range; results require review and do not implicitly save or edit the project.

Contextual audio menus and floating-input requests share Producer tools. `render_clip` persists a `client_render` event; an open project browser claims the request and renders an immutable accepted snapshot with the existing audio engine. The result uploads through owned media storage and registers as a completed job; a reference-only render cannot be applied. Claim/result identity prevents duplicate registration. No server synthesizer is added. Version and lock validation apply before rendering and before staged edits are accepted.

Music references capture owned immutable sources and explicit windows separately from destination context. FFmpeg extracts the selected window; short references repeat to the provider upload minimum of 10 seconds while the conditioning range retains the original duration. The adapter uploads real bytes and records the paid upload identity before generation. Failed or unknown outcomes never trigger paid replay or text-only fallback. Shared deterministic proposal identities keep agent staging and manual job acceptance aligned, including after analysis sources are persisted.

Producer workflow revision: new completed runs apply their validated batch automatically through normal command receipts and version/lock checks, then emit completion. Each batch is one undoable draft operation and does not save. Browser completion reloads the accepted project. Generated results remain retained on conflicts; paid generation is never replayed. Historical proposals do not auto-apply on page load. Earlier descriptions of explicit Producer Apply controls are superseded by this workflow.

Local experiment storage uses the same immutable S3 object/asset protocol with persistent S3rver files. Explicit loopback endpoints permit HTTP and path-style addressing; remote endpoints still require HTTPS and scoped temporary cloud sessions. Local browser sessions accept only the emulator's public test credentials, preventing production root keys from being returned through this branch. Media bytes still travel directly between browser and object store. The Node API owns reservations, object integrity, ownership and accepted project state.

## Browser performance recording

`AudioEngine.preparePlayback` loads/resolves accompaniment without scheduling its onset. `PerformanceRecording` prepares `VocalRecorder` on the engine-owned AudioContext, then schedules finite count-in clicks, accompaniment and worklet capture at one sample-aligned onset. Recorder teardown releases its microphone/worklet without closing that shared context. Browser/network readiness gates preparation, never individual beats. Input/output hardware latency remains uncalibrated.

`use-performance-recording.ts` owns the immutable recording origin/tempo/version, capture phase and pending recovery PCM. Stopping uploads through the existing direct media protocol, then `performance-placement.ts` creates one ordinary audio source, library part, unmuted track and Clip through an idempotent versioned batch. Earlier recordings are untouched. Failure retains local PCM for retry/download and participates in the shared departure guard; no new take manager or implicit Save is introduced. The legacy reference-recording path is unchanged.

`producer-control.ts` and the shared studio-control schemas validate page-owned request/claim/result events. The initiating browser identity travels through text submissions and realtime delegation. A fresh page identity prevents replay after reload; one claim and a local work map prevent duplicate execution. The browser handles only active runs. Preparation reports armed separately from subsequent capture/content acceptance and cannot share a run with staged content edits. Cancelled/stale requests cannot start recording. `use-producer-performance.ts` waits for run completion and, for voice, `RealtimeVoice`'s response-complete plus local-audio-drained callback before starting the local scheduler. Interruption cancels an armed plan.

Realtime hold clears input buffering and cancels old speech while suppressing conversation microphone uplink and audio playback. Release restores the same socket/session with unchanged voice and default VAD; it sends neither a new greeting nor call cues. Song capture remains on the separate studio clock. See [performance controls and recovery](performance-recording.md) for the UI and verification limits.

Conversational `record_audio` uses a separate mandatory `recordingPlanSchema` for phrase, destination, finite beat range, count-in, accompaniment and follow-up. General transport requests cannot bypass these fields. `PerformanceRecording` bounds the accompaniment and arms an exact worklet end frame; dry humming skips accompaniment resolution/output. Manual Record remains unbounded until stopped. Controlled placement uses deterministic IDs/receipts and can target an explicit unlocked audio track without changing old clips or mix state.

Finite accompaniment has a final AudioParam output gate at the recording end, including effect tails. Its metronome scheduler never queues pulses at or beyond that horizon. Worklet completion still releases resources, but main-thread cleanup timing cannot extend audible playback or the captured range.

Recording lifecycle acknowledgements are scoped to the originating run and page. `verifiedRecording` checks the actual accepted command receipt, source/Clip geometry and owned asset before exposing current-version context. A live realtime session consumes `demotif.recording_result` once, waiting for active speech to finish; text continuation uses a deterministic run ID. Application follow-ups hide the synthetic control marker from user transcript rendering. Processing reuses existing audio jobs and typed edits. Partial recordings retain recovery audio and do not silently continue as complete phrases. Fresh pages and history replay never recreate capture or continuation.

The `save_project` and `export_audio` tools dispatch existing browser file actions through the same ownership/acknowledgement bridge. Save acknowledgement verifies the new clean draft version. Tool controls serialize within a run so sequential file operations observe that new version. Pending musical edits cannot mix with recording preparation or file operations.
