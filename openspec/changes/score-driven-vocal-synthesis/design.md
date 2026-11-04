## Context

See proposal.md for scope. Current sources contain instrumental notes/drums or audio; `track.kind = vocal` alone adds no singing capability. `source.update` already validates a merged source and checks all locked placements sharing it. The existing audio-provider queue generates music/speech and cannot preserve a supplied vocal score. Browser workers currently render instruments and encode WAV, not singing models.

The user explicitly permits heavy, non-real-time server computation and prioritizes quality over browser execution. This supersedes the browser-only synthesis sentence in `openspec/config.yaml` and the earlier research note; it does not move real-time transport, monitoring or existing instrument synthesis to the server. All project mutations still require typed commands, expected versions, locks and append-only undo.

The observed development host is arm64 macOS with 24 GiB RAM. No NVIDIA GPU or model benchmark is established. A persistent Next.js Node process with writable SQLite/media storage is already required.

## Goals / Non-Goals

**Goals:** implement our own score/editor/job integration around an existing controllable singing model; validate one real voice end to end before investing in a full editor; keep the model process replaceable and the musical score portable.

**Non-Goals:** a new general Python web backend, a commercial product's proprietary voice engine, recording/training a singer, browser-only inference, a pretend singing preview implemented with speech or formants, and infrastructure for multiple application replicas. No model weights or GPU purchases occur during planning.

## Decisions

### 1. Native DiffSinger PyTorch inference in an isolated Python worker

Use the official OpenVPI DiffSinger native inference implementation, pinned to a tested revision, with its acoustic and applicable duration/pitch/variance checkpoints, matching model configs, phoneme/language dictionaries and native vocoder checkpoint/config. Implement a narrow adapter in `workers/singing/` using Python 3.11, PyTorch and NumPy plus the selected upstream inference dependencies; pin the complete tested environment after a real-checkpoint test. Keep model modules in evaluation mode and follow upstream no-gradient/inference behavior. Do not independently reconstruct the neural stages merely to convert them to another deployment format.

OpenVPI's native `scripts/infer.py variance` and `acoustic` path takes DS score files and loads checkpoints into PyTorch modules. First reproduce these commands with the exact model/config revision to establish the quality baseline; then adapt their inference classes into the warm worker while preserving preprocessing, sampler, seed, precision and vocoder settings. Avoid upstream CLI global-state conflicts by isolating model state in the worker. Reused upstream code requires its actual revision's license/attribution.

CPU inference is the correctness baseline on the current Mac. Use native PyTorch CUDA on a compatible GPU deployment when available. Do not promise MPS support, CUDA speed or mixed-precision parity without actual model tests. Heavy inference remains outside Next.js request execution and outside browser audio callbacks. Start with the upstream validated full-quality precision/settings; any later reduced-step or lower-precision preview requires its own listening and numerical evaluation and cannot silently replace the final-quality path.

The first release has no ONNX export, ONNX Runtime, quantization or graph-porting work. ONNX-only voice packages cannot be loaded as native checkpoints: no reverse conversion or missing-checkpoint reconstruction is planned. Do not claim an ONNX distribution demonstrates availability of its native checkpoint/config. Select another legitimately obtainable native package if those artifacts are unavailable.

Alternatives considered: ONNX is a valid deployment option, but is unnecessary for this Python worker and adds conversion/runtime consistency work before a baseline exists; a headless OpenUtau bridge adds a second runtime; a formant synth does not satisfy the selected quality direction. Future deployment optimization is outside this first implementation, not a prerequisite for native inference.

### 2. Voice selection is a measured first milestone, with a native-checkpoint eligibility gate

The user has no fixed language preference. Select exactly one voice and one supported language after comparing official examples and original test phrases. Require native PyTorch acoustic/variance checkpoints, the matching model configs and dictionaries, and a compatible native vocoder checkpoint/config before evaluating a candidate for integration. This is a concrete acquisition/quality milestone, not permission to call an arbitrary download production-ready. Previous voice names are research leads only; none has established native-checkpoint eligibility.

| Candidate/component | Observed primary-source evidence | Decision |
| --- | --- | --- |
| Printto Magicbeat V5 Pure / Commercial Pack | Owner lists a single-voice-data pack with Thai/Japanese/English; terms allow commercial vocals but prohibit repackaging the voice library without permission | Research lead only. Native checkpoints/configs are unverified; exclude an ONNX-only release. Do not bundle or assume public hosted use is permitted |
| Chiaki | Owner permits commercial creative output but requires contact for commercial application embedding; downloaded model availability is not established by its current landing page | Research lead only. Native checkpoints/configs and intended-use terms must qualify it before any benchmark |
| Team L❤VE voicebanks | Owner allows commercial creative use with attribution; redistribution and ports have separate conditions | Research pool only; exact native checkpoint/config release still required |
| Potluck vocoder | Custom terms permit commercial DiffSinger use with attribution and restrict use for model training | Candidate only if native checkpoint/config and acoustic compatibility are established; not a universal replacement |
| OpenVPI community vocoders | Published weights use CC BY-NC-SA 4.0 | Do not make these a silent commercial-production default |

Record upstream revision, checkpoint/config versions, source URL, file digests, language inventory, sample rate/hop/mel configuration and applicable terms for every installed profile. A technical profile describes available models, not a new runtime whitelist. Installing a legitimately usable additional profile must not require a code change. Separate permission to publish resulting songs from redistribution, local execution and hosted-service rights. Do not contact owners or accept paid/commercial agreements automatically.

The repository ships the adapter and attribution support, not third-party weights or portraits. The first local evaluation uses operator-installed weights under their applicable terms. Public hosted use/bundling is a separate release decision. If no candidate permits the intended deployment, deliver the measured adapter spike and the exact unresolved terms instead of silently substituting low-quality synthesis.

### 3. Next.js owns jobs; one warm model process owns tensors

Keep the standard root-level Next.js structure. Add `workers/singing/` as an inference package, not `backend/`. A lazy long-lived child process communicates over JSON Lines on stdin/stdout; stderr is reserved for diagnostic logs. Each message includes protocol version and job ID. Requests reference a server-written immutable score snapshot and output directory; responses describe progress stages, resolved timings/pitch, audio files and errors. PCM is transferred as files, not base64 JSON.

Initially allow one active inference per worker so loaded weights remain warm and memory use is predictable. SQLite persists the queue, and a Next.js dispatcher claims work after initialization and enqueue; polling/status requests are not the only way queued work starts. Reuse the existing `Slots` primitive only where its lifecycle fits. Add no Redis, Celery or public worker API. Cancellation prevents queued jobs from starting; active cancellation terminates an unresponsive worker if its inference call cannot be interrupted, then lazily restarts it. A process crash marks running attempts interrupted; queued/current requests can be retried with the same immutable key. A completed file is validated and atomically published before its job becomes ready.

A future hosted adapter can replace the child process with a private remote GPU transport implementing the same versioned request/result contract. Node remains the sole project/database writer; remote workers receive only render inputs and return artifacts. Hosted authentication, storage and orchestration are outside this change.

### 4. Add vocal sources without breaking old projects

Extend `source.kind` with `vocal`; preserve all existing variants/defaults. A vocal source uses the existing source notes plus a `vocal` payload containing `voice_id`, `language`, note-ID-keyed syllable assignments, pronunciation overrides and expression. Each assignment is either a lyric syllable or an explicit continuation of the preceding syllable. Rests are note gaps. Vocal notes must be monophonic; instrument notes remain polyphonic. Invalid overlaps and broken continuation groups produce actionable errors rather than silent note removal.

Store pitch-offset curve points in source-local beats and cents relative to the current score pitch. Store vibrato rate/depth/onset and a volume curve with defined units. Interpolate inside voiced groups only, never through rests. Manual pitch overrides are distinct from model-generated pitch; predicted pitch/timings are derived sidecars. Resizing notes preserves user intent through deterministic remapping or a visible correction, not silent loss. Explicit pronunciation timing overrides use musical durations and must fit their syllable group's available time. Blank lyrics remain editable, but a render request reports the affected notes instead of inventing pronunciation.

Extend typed `source.add` / `source.update` contracts and document validation. Lyrics, notes and curves are changed atomically where references would otherwise break. Parameter sliders commit once on release. Producer tools use these exact commands. Editing a source used by a locked clip/track retains the existing shared-source lock rule. New optional/default fields allow old projects/examples to load without migration writes.

### 5. Phrase compilation keeps context and exact score timing

The server compiles the accepted source into monophonic phrases using rests and model context requirements. Do not split arbitrarily at every bar or fixed number of seconds. A long uninterrupted phrase remains intact initially; only add context-preserving chunking after measured need. The model profile declares pre-roll, tail and context rules.

Convert source-local quarter-note beats to seconds with `60 / tempo`. Preserve consonant lead-in and final release through explicit artifact offsets/padding; clip trims/loops must use the same alignment. Request/return frame hop and sample rate in metadata. User phonemes override automatic pronunciation; user pitch overrides model pitch in their defined regions. Run the matching duration/pitch/variance, acoustic and vocoder stages, with a fixed seed per job attempt. A preview preset must come from supported model controls and disclose its quality; final mode never silently inherits a reduced preview preset.

### 6. Cache depends on the musical input, not every project version

A phrase key includes canonical score/lyrics, phonemes and timing overrides, user curves, relevant neighboring context, voice/model/vocoder/phonemizer/compiler versions and file digests, PyTorch/runtime version, device backend, precision, sampling settings, tempo, quality preset, seed and native sample rate. Backend/precision changes must not silently reuse an unvalidated result. Exclude unrelated project names, mixer gains and arrangement positions. Source movement/mix changes reuse vocal PCM; tempo, pronunciation or voice changes invalidate affected phrases. Invalidate adjacent phrases if their context dependencies change.

Use project-scoped SQLite `vocal_requests`, `vocal_jobs` and `vocal_renders` tables plus immutable files in `data/media/`. A request groups phrase keys for one source snapshot and owns its cancellation handle; a job is one immutable phrase/preset computation shared by equivalent requests. Persist request-to-phrase membership as JSON in the request record. The API returns the request handle plus per-phrase job status, and cancellation detaches that request before cancelling jobs with no remaining live request. Persist request snapshot, phrase key, attempt, status, progress stage, output metadata and structured error. Job states are queued, running, ready, failed, cancelled and interrupted. Stale is a relationship between a result key and the current source, not a failed render. Duplicate requests reuse queued/ready work; retry is explicit for failed/interrupted attempts.

Rendering creates derivative assets and provenance records, not new score edits or replacement audio clips. It must not mark a clean score dirty, advance its project version, or bypass command approval by rewriting notes. A compare-and-publish transaction checks the current source fingerprint before binding a result; obsolete results may remain cached but never become current. Existing asset ownership and path handling apply. Save/Save as/draft cloning must copy usable render bindings and project asset metadata with remapped ownership; preserve immutable blobs and allow regeneration from the score when a binding is absent. Undo can reuse a previously matching render.

### 7. Small same-origin API, existing status mechanism

Proposed endpoints in `src/server/api.ts` through `src/app/api/[...path]/route.ts`:

- `GET /api/vocal-voices`: installed profiles, validated language/control capabilities, readiness, attribution and missing-installation reason; no local paths or secrets.
- `POST /api/projects/:id/vocal-renders`: source ID, expected project version and preview/final preset; server reads and snapshots the accepted source. Return job/current phrase statuses and cached results.
- `GET /api/projects/:id/vocal-renders/:requestId`: persistent status, stage, provenance and same-origin asset references.
- `POST /api/projects/:id/vocal-renders/:requestId/cancel`: cancel this request; shared results/jobs still needed by another subscriber are not destroyed.
- `GET /api/projects/:id/vocal-sources/:sourceId/render`: resolve the current fingerprint to ready/missing/stale phrase bindings for reopening/playback.

Use ordinary short polling while jobs are active, stopping when terminal or the project closes. Do not add a second WebSocket system or promise model-stage percentages when only stages are known. Validate project/version/source/model compatibility, not arbitrary host allowlists or invented phrase limits. No new paid provider dependency.

### 8. One editor, direct controls, explicit initial rendering

Add Vocal to the existing library-plus creation dialog, with voice/language selection from installed profiles. Extend `part-editor.tsx` or extract its piano-roll rendering so note move/resize/audition geometry remains shared. Render actual lyrics on notes where readable; clicking opens a centered modal dialog for lyric/pronunciation and note parameters. Whole-phrase lyric assignment and voice/settings use dialogs. Pitch and volume lanes are collapsible; no permanent parameter sidebar. Side/bottom motion, text sizes, keyboard control, flat LED theme and reduced motion remain unchanged.

Start with an explicit Synthesize action and Retry/Cancel states. Editing marks relevant output stale immediately, and synthesis reads committed edits. Do not automatically start repeated expensive jobs on every pointer move. Parameter controls are enabled only if the installed profile implements them, with an actionable reason when unavailable. Closing the editor returns arrangement space and stops audition; it need not cancel a render intentionally queued for the whole project. Explicit Cancel, source deletion, project departure or superseding a request detach/cancel its work according to subscriber ownership.

### 9. Browser playback consumes prepared audio; export checks completeness

Add a derived-render resolution layer to `src/audio/adapter.ts` and the loading/preparation path. Keep the source as editable vocal data, mapping ready phrase buffers to temporary engine playback assets with exact offsets. Existing browser mixing, routing, loop, seek and WAV encoding consume those buffers. Decode/resample into the playback context once; do not change PCM pitch with playbackRate after tempo edits. Model-native intermediate WAV preserves precision; final mix can continue using the existing stereo 44.1 kHz/16-bit export.

Snapshot ready phrase bindings before a playback run. If an audible vocal phrase is missing/stale, show it and require rendering or explicitly muting the vocal track; do not play an old result as if current. Newly finished output is adopted on the next preparation rather than swapping a playing buffer mid-phrase. Export renders an immutable accepted score snapshot and verifies every audible vocal phrase in final quality; it can wait with progress/cancel or fail visibly. Muted/non-soloed sources are not required. Concurrent score edits do not silently change an export already in progress; its UI identifies it as a snapshot.

A server full-mix export adapter is not required for this first slice. This is a scope choice, not a permanent browser-only restriction for non-real-time export.

### 10. Verification and staged acceptance

Milestone A is an actual phrase WAV, not an editor mock. Use original/public-domain material and the same score in the reference renderer and adapter. Test 2-, 5- and 10-second phrases including repeats, silence, continuation, a pitch jump and a tail; then a 30-second assembled example. Record cold model load, warm wall time/audio duration (RTF), peak RSS, audio format and actual device/provider/version. Add CUDA measurements only when that device exists. No latency, naturalness or MOS claims are established by this plan.

Adapter output must match reference note/phoneme alignment within one model frame after documented lead-in/rounding; fixture PCM must be finite, correctly sized and free of unexplained truncation. Compare seeded outputs within the chosen runtime's justified tolerance; listen for pronunciation errors, clicks and degraded transitions. If the reference itself sounds poor, change voice/profile before expanding UI. Verify duration and cache/stale/cancel behavior with automated tests, but do not use waveform equality as a proxy for musical quality.

Milestone B adds versioned score/lyrics and persistence; C adds durable worker/cache and a minimal usable editor; D verifies playback/loop/export, Producer and desktop/narrow keyboard workflows. Mock workers cover failure paths; an opt-in real installed-model integration test produces audible artifacts. Unconfigured installations retain all existing music features and explain how to install singing dependencies.

## Risks / Trade-offs

- Model terms differ between output, redistribution and hosted inference → use the exact release terms and retain a candidate record; local evaluation does not imply production approval.
- Native checkpoint architectures/configs/phoneme dictionaries vary → support one inspected profile first, use explicit capabilities and compare against the reference engine.
- CPU inference may be slow; GPU support is unmeasured → warm models, cache phrases and keep transport independent; measure before choosing deployment hardware.
- A long phrase can exceed memory → report model failure cleanly; introduce chunking only with context/alignment tests, not arbitrary musical truncation.
- Consonant lead-in/release crosses clip boundaries → store alignment metadata and test trims, loops, source reuse and export.
- Model-generated pitch changes with context → keep manual overrides separate and include context/seed/model version in cache keys.
- Save/undo/concurrent jobs can point at old audio → transactionally compare fingerprints and test cross-tab updates, draft cloning and undo reuse.
- A killed warm worker loses other active work → one active job initially; durable queue and explicit restart state.
- Native inference dependencies can conflict with analysis Python → separate `workers/singing/.venv`, no new import in the Next.js bundle or the existing analysis environment.

## Migration Plan

1. In implementation, update AGENTS.md, `openspec/config.yaml`, architecture and research notes to record the user-authorized offline/server inference exception; retain browser real-time invariants. This planning change does not rewrite those files yet.
2. Add the optional worker package/model profile installation instructions and example environment configuration. Suggested variables: `DEMOTIF_SINGING_PYTHON`, `DEMOTIF_SINGING_MODELS_ROOT`, `DEMOTIF_SINGING_DEVICE` (cpu/cuda). The server starts without singing installed.
3. Back up SQLite through the existing mechanism; add vocal tables and backward-compatible schema defaults. Keep all existing media/documents intact. Ship no weights in Git or public assets.
4. Enable the first inspected voice profile after Milestone A; add score commands/editor and then playback/export integration. Extend draft/save cloning for derived bindings.
5. Rollback by disabling singing dispatch and using the prior database backup if older code cannot parse newly saved vocal sources. Never strip vocal data to force an old build to open it. Cache artifacts remain reconstructible; existing instruments/audio keep working.

## Sources and Remaining Evidence

Sources checked 2026-11-04; landing-page assertions are not substituted for archive licenses or measurements.

- [OpenVPI DiffSinger getting started](https://github.com/openvpi/DiffSinger/blob/main/docs/GettingStarted.md), [engine license](https://github.com/openvpi/DiffSinger/blob/main/LICENSE).
- [Native acoustic inference](https://github.com/openvpi/DiffSinger/blob/main/inference/ds_acoustic.py), [native variance inference](https://github.com/openvpi/DiffSinger/blob/main/inference/ds_variance.py). OpenUtau remains an editor/phonemizer reference, not the selected inference runtime.
- [Printto voice releases](https://printmov.com/printto), [Commercial Pack terms](https://printmov.com/commercial-pack).
- [Chiaki owner terms](https://chiaki.ch/en/character/chiaki), [Team L❤VE terms](https://lottev.moe/utau/voicebank-license/).
- [Potluck terms](https://github.com/mrtigermeat/potluck-vocoder/blob/main/LICENSE), [OpenVPI community vocoder terms](https://openvpi.github.io/vocoders/).
- [ACE Studio vocal workflow](https://docs.acestudio.ai/ai-vocal-synth/creating-ai-vocals), [pitch editing](https://docs.acestudio.ai/ai-vocal-synth/creating-ai-vocals/editing-pitch).

The exact single voice/language, native-checkpoint/config eligibility, dependency pins, seed tolerance and numerical latency are outputs of the named acquisition/reference-render milestone. They must be recorded before editor implementation; the architecture and capability contracts do not depend on a particular singer identity. No model files were installed or executed during planning.

## Lyric entry refinement

A modal note editor accepts a phrase inside the selected note by default. It preserves note geometry and following assignments; there is no placement-mode selector or overflow warning based on remaining note count. An explicit Split action divides only the selected note equally, applying notes and lyrics atomically. Optional legacy mode metadata remains readable, but unmarked phrases also mean multiple syllables within one note. Pronunciation overrides are space-separated syllables, and raw phonemes retain precedence. The whole-clip Lyrics dialog retains bulk assignment and existing within-note grouping.

Piano and drum editors delete on right-click, select existing notes on left-click, and create on empty space. Double-click does not delete. Duration controls and resizing snap edits to the quarter-beat editor grid; display at most two decimals and preserve imported timing until an actual edit.

The compiler expands a multiple assignment into dictionary phonemes. Initial syllable budgets equally divide the original note; a following continuation extends only the final syllable. Per-syllable consonant/vowel initial ratios preserve the existing native inference defaults. Manual pitch remains independent of lyric segmentation; the note's pitch and expression continue to drive F0. These timings are deterministic defaults, not a new prediction model. Notes/lyrics/mode are committed in one source.update, preserving locks, save checkpoints, undo and cache invalidation. Validation uses top-center notifications and hidden accessible descriptions, with no inline error layout.
