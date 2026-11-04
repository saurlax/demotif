# Demotif architecture

Demotif is a local Next.js full-stack music workspace. The browser owns audio; the Node runtime owns accepted
project state, saves, history, media access, and optional producer/provider execution. No Python HTTP service runs.

## Runtime boundaries

```text
Browser: React studio + Web Audio + two lazy Workers
   │  typed JSON commands / uploads / resumable SSE
   ▼
Next.js App Router (Node runtime, persistent local process)
   ├─ shared Zod contracts and validated project services
   ├─ SQLite transactions, append-only operations, editing drafts
   ├─ local assets and built-in sound/example catalogs
   ├─ Vercel AI SDK producer and staged tools
   └─ durable audio-provider jobs / optional analysis subprocess
        │
        ▼
SQLite + filesystem in data/; optional configured providers
```

Realtime playback, seeking, audition, clip loops, effects, and OfflineAudioContext WAV export remain browser-local.
No remote stream or render queue sits in the transport path. The same DSP/graph serves playback and export.
Generation and analysis are distinct provider operations whose results require explicit accepted commands.

## Layout and commands

- `src/app/`: Next.js routes, root layout, client workspace boundary, and Node API route handlers.
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
addresses, pin DNS during connection, revalidate redirects, and bound bytes/time. ffmpeg uses local-file/pipe protocols.
Optional transcription invokes the bounded `analysis/transcribe.py` subprocess and keeps original recordings intact.

## Storage and migration

Server-only `.env.local` configures providers and optional storage paths. Relative paths resolve from repository root;
defaults are `data/demotif.db`, `data/media/`, `data/examples/`. No credential uses a NEXT_PUBLIC prefix.

Stop the old API, then run `npm run migrate:local`. SQLite's backup API copies the database consistently; media/examples
are copied without overwriting existing destination files. Original local files and configuration are retained. The Node
adapter also creates a pre-Next.js SQLite backup before initialization. For rollback, stop Next.js and use the retained
legacy code/state consistently; do not combine two writers. Do not overwrite an existing destination database automatically.
The migration adds no backend audio renderer, genre shader, or automatic project save.

## Deferred work

Microphone capture/count-in, latency compensation, live pitch correction, multi-user access, hosted storage/database,
and adaptive studio atmospheres remain separate work. Playback/export does not depend on provider availability.
