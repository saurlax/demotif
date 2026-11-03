# Demotif architecture (local-first)

Status: local music studio with browser synthesis/sampling, arrangement and note editing, mixing, WAV export,
server-owned commands/history, and optional configured producer/audio services. Microphone recording and live pitch
correction are not implemented.

## Runtime boundaries

```text
┌──────────────────────────── browser ────────────────────────────┐
│ Studio UI (React)        Audio engine (Web Audio + Workers)  │
│  arrangement, mixer       transport clock, synthesis, sampling  │
│  producer chat            Clip audition, effects, WAV export   │
└───────────────┬─────────────────────────────────────────────────┘
                │ /api (typed commands, JSON)
┌───────────────▼─────────────────────────────────────────────────┐
│ Python API (FastAPI)                                            │
│  project document · version CAS · operation log · assets         │
│  a13n producer, staged proposals, durable SSE events               │
│  optional audio adapters (never in the audio path)           │
└───────────────┬─────────────────────────────────────────────────┘
                │
        SQLite + local media  →  Postgres + object storage (hosted)
```

Two rules drive the design:

1. **The project document is the source of truth.** The UI renders it; the producer only proposes commands against it.
2. **Real-time audio never waits on the network.** Recording start, metronome, and monitoring are browser-local. The
   agent participates before/after a take, not in the sample-accurate path.

## Repository layout

```text
demotif/
├─ frontend/
│  ├─ src/
│  │  ├─ app/providers.tsx          # Query client, tooltip provider
│  │  ├─ components/ui/             # shadcn/ui (base-nova, Base UI)
│  │  ├─ features/
│  │  │  ├─ projects/               # project list + create
│  │  │  └─ studio/                 # arrangement, editors, mixer, project menu, transport, producer
│  │  ├─ audio/                      # DSP, Web Audio graph, render Workers, adapter
│  │  ├─ lib/api.ts                 # typed HTTP client
│  │  ├─ stores/studio.ts           # playback/UI state (Zustand)
│  │  └─ types/project.ts           # document + command contracts
│  └─ vite.config.ts                # @ alias, /api proxy → 127.0.0.1:8200
├─ backend/
│  ├─ app/
│  │  ├─ main.py                    # app factory, lifespan, error mapping
│  │  ├─ api/routes/                # projects, commands, messages, assets, health
│  │  ├─ core/                      # settings, domain errors
│  │  ├─ db/                        # async engine/session, declarative base
│  │  ├─ models/project.py          # Project, Operation, Revision, Asset, ProducerRun/Event, AudioJob
│  │  ├─ schemas/                   # document, command, project, asset, agent DTOs
│  │  ├─ services/                  # project + command (transactions)
│  │  └─ adapters/
│  │     ├─ agent/                  # Producer protocol + a13n adapter
│  │     ├─ audio/                  # gateway and bounded offline analysis
│  │     └─ storage/                # LocalBlobStore
│  ├─ tests/                        # command protocol tests
│  └─ pyproject.toml                # uv-managed
├─ openspec/                        # specs + change proposals
├─ .agents/skills/                  # OpenSpec skills (vendor-neutral)
├─ docs/architecture.md
├─ AGENTS.md
└─ README.md
```

Audio implementation lives in `frontend/src/audio/`; studio views remain in `frontend/src/features/studio/` and use
Demotif's existing theme, Base UI components, and application shell.

## Data model

- `Project` — name, `version`, `document` (JSON), timestamps. The document embeds tracks and clips:
  `{ tempo, time_signature, key, tracks: [{ id, name, kind, locked, muted, solo, clips: [...] }] }`.
- `Operation` — append-only forward/inverse field or entity deltas, metadata, and optional `undo_of` link.
- `Revision` — legacy read-only snapshots retained for compatibility; new edits never write these.
- `Asset` — uploaded audio/video metadata; content lives in the storage adapter (`backend/data/media/<project>/...`).

Why JSON for the arrangement: the document is edited atomically as one unit, matches the command protocol, and maps
directly to a `jsonb` column when moving to Postgres. Normalize into tables only when a query needs it (e.g. asset
search, collaboration).

## Producer Command Protocol

Request to `POST /api/projects/{id}/commands`:

```json
{
  "command_id": "generated-if-omitted",
  "expected_version": 4,
  "command": { "type": "clip.add", "track_id": "…", "name": "Verse", "start_beat": 8, "length_beats": 16 }
}
```

Invariants:

- `expected_version` must equal the stored version; otherwise `409 version_conflict` with `current_version`.
- Commands affecting locked tracks/clips fail with `409 locked_section`. Toggling the lock itself is allowed.
- Every accepted command atomically updates the current document and appends an operation; responses keep revision metadata for API compatibility.
- Undo (`POST /projects/{id}/undo`) applies the latest active operation inverse and appends a compensation linked by `undo_of`; consumed operations and compensations are skipped by later undo. History is never rewritten.

Implemented commands: `project.rename`, `project.set_tempo`, `track.add`, `track.remove`, `track.set_lock`,
`clip.add`, `clip.move`, `clip.remove`, `clip.update`, `clip.split`, `track.update`, `source.add`, `source.update`,
`part.add`, `part.remove`, `mixer.set`, `project.set_time_signature`, and `project.set_sections`.

`POST /projects/{id}/commands/batch` accepts `{request_id, expected_version, commands}`. It commits one validated
version and one reversible operation. Request receipts deduplicate retries. Shared source edits check every referencing
track/clip lock; duplicate the source explicitly to edit an unlocked instance independently. Bus routes reject cycles.
Entity arrays use stable IDs; ordinary value arrays (including automation points) use reversible replacement values.

The producer (`POST /projects/{id}/messages`) returns `{ reply, commands }` and does **not** auto-apply. The UI shows
the proposed edits and applies them through the command endpoint, preserving explicit user approval.

## Adapter seams (hosted migration)

| Concern | Local | Hosted target | Seam |
| --- | --- | --- | --- |
| Project DB | SQLite (`aiosqlite`) | Postgres (`jsonb` document) | SQLAlchemy session + `DATABASE_URL` |
| Media | `LocalBlobStore` | Signed object storage | storage adapter interface |
| Producer | optional configured a13n harness | hosted agent | `Producer` protocol |
| Generation | optional audio gateway / offline analysis | provider APIs | durable jobs; outputs become assets |
| Auth | none (single local user) | platform identity | request-scoped user dependency |

Keep browser audio code independent of these adapters. The backend never touches audio buffers in the real-time path.

## Local ports and commands

| Service | Port | Note |
| --- | --- | --- |
| Vite | 5173 | proxies `/api` to the backend |
| FastAPI | 8200 | 8000–8197 sit in a Windows excluded port range on this machine |

```bash
cd backend && uv run uvicorn app.main:app --port 8200
cd frontend && npm run dev
cd backend && uv run pytest
cd frontend && npm run build
```

## Musical state and audio runtime

Stored media Assets remain independent from reusable Sources. A Source holds notes/instrument settings or an audio
Asset reference. Saved Parts store named source windows. Clips reference Sources and own their timeline positions,
source windows, gain, and fades. Musical note/arrangement/automation time uses quarter-note beats; recorded source
windows use seconds. Tempo is 20–300 BPM with one decimal place. The render adapter alone converts beats to seconds.
A tempo edit updates audio clip display lengths while preserving recorded source seconds and musical start beats.

AudioContext owns playback time. Two lazy Workers synthesize longer sources and encode WAV; decoded immutable media
is shared and project release invalidates stale work. Playback, Clip loops, and OfflineAudioContext export share voices,
envelopes, routing and effects. Global and clip playback are mutually exclusive. Waveforms derive from decoded audio.
UI gesture drafts are temporary; React Query contains only accepted project documents.

## Producer and audio jobs

`/projects/{id}/producer` restores run/event history. Runs have independent background lifetime, base versions,
checkpoints, typed proposed commands, and monotonic SSE cursors. Tools stage validated edits on a private copy.
Applying a proposal goes through the atomic command service; stale proposals cannot overwrite manual work. Closing
SSE does not cancel execution. Explicit cancellation stops future model work; startup marks abandoned runs interrupted.
The real adapter exposes only musical project and configured audio tools, never shell or host filesystem tools.

`/projects/{id}/audio-jobs` stores generation/analysis requests and results. Equivalent request/take combinations reuse
one durable identity. Submission intent is saved before network calls; uncertain submissions are never automatically
repeated. Known upstream jobs can be explicitly resumed. Audio downloads are bounded, public HTTPS only, DNS-pinned,
and normalized through ffmpeg with local-file/pipe protocols. Results become local media; adding musical Sources or
placements still uses commands. Offline source analysis is optional and is distinct from future realtime pitch detection.
Generated vocal separation currently accepts generated sources, not arbitrary local imports.

## Roadmap

Microphone capture/count-in, latency compensation, live pitch correction, multi-user access, and hosted adapters remain
separate future work. Current local audio editing and playback do not depend on provider availability.

## Workspace UI source

The shell originated from official shadcn/ui sidebar-15, Base UI/base-nova:
https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json (retrieved 2026-11-03). Shared tokens and primitives now
use flat graphite surfaces, acid-yellow actions, mint playback feedback and Geist typography. Home and global
library pages retain project navigation and restrained layouts. The studio hides global navigation and shows a
project-name file menu, save state and undo above the workspace tools/transport row. Producer exists only inside
projects. Global audio/instrument browsing never selects or creates a project.

Library and Producer enter/exit horizontally; clip editors and mixer enter/exit vertically with retained closing
content and reduced-motion handling. Arrangement and library drags share ClipDragPreview. Editing surfaces disable
native text selection while inputs remain selectable. Actual note/waveform data drives previews and audition progress.
Adaptive atmosphere shaders and music-reactive backgrounds remain a deferred proposal, with no implementation.


## Lightweight operation history

Each accepted command updates the authoritative Project document once and writes only its forward/inverse deltas to Operation. Scalar deltas contain a stable-ID path and value; insert/remove/move deltas preserve entity identity and order. Deleted tracks retain their own subtree for restoration, without unrelated tracks. Creation is a non-undoable baseline. A lock history payload is independent of unrelated project size. The current document is still validated, diffed, and written, so this does not make every edit constant-time or remove project-sized processing.

Updates use database compare-and-swap on project ID and expected_version in the same transaction as history insertion. The internal monotonic counter stays in APIs for stale-edit protection and is not displayed. ProjectRead.can_undo reports actual remaining active history. Undo walks backward through ordinary operations, skips already compensated operations, and remains correct after restart or an edit following undo. Ordinary commands retain locked-section validation; undo restores server-owned prior values through internal deltas, not unrestricted client restoration commands.

Startup backs up a legacy SQLite database using SQLite's backup API before schema/history changes, to backend/data/demotif.db.pre-operations-<UTC timestamp>.bak. An additive operations table is created, then adjacent legacy snapshots are converted transactionally. The baseline entry doubles as a completed-migration marker. Missing revisions, inconsistent current state, or invalid deltas abort conversion without a partial project history. Restarting does not duplicate entries or backup completed migrations. Original Revision rows remain untouched; old snapshot undo transitions are imported as actual historical transitions, and subsequent undo uses the new compensation semantics. No historical snapshot pruning is performed. Do not run an old server writer against a migrated database. To roll back, stop the server and restore both the pre-migration database backup and matching code. Hosted storage/provider seams are unaffected.

## Arrangement clip presentation

Arrangement clips display shared source windows with real note or decoded waveform previews. Note strokes retain
consistent screen-space thickness; waveform density follows display width. The floating move/library preview uses
the same card content and velocity-driven sway, with faded origin and snapped destination. The ruler supports drag
seeking and section labels, and Follow centers the playhead outside manual gestures. Audio clip editors retain a
fixed time scale and horizontal scrolling rather than squeezing long recordings into the viewport.


## Explicit saves and editing drafts

Opening a saved project creates an isolated server-validated draft with the saved project ID and base version.
Examples open as drafts without a saved base. Drafts use the same typed command, media ownership, lock and
append-only undo protocol, but never appear in project listings. Their accepted name/document is compared with
an opening/save checkpoint to report unsaved changes, including a clean result after undo restores that content.

`POST /api/projects/{id}/drafts` opens a regular project. `POST /api/projects/{draft_id}/save` accepts an expected
draft version, optional `save_as` and name. Save publishes the accepted snapshot to its saved base using a version
compare-and-swap; Save as creates a saved project and gives the draft that new base. Saving copies media ownership
while retaining immutable local blobs. Draft and saved-project changes commit atomically. Examples require Save as.
A stale saved base cannot be overwritten from another tab; the draft remains available to save separately.

The browser's native `beforeunload` warning covers accepted-but-unsaved content, pending commands/uploads/saves,
and uncommitted inputs. Data-router navigation blocking converts dirty in-app exits into full document
navigation, so the same native warning also covers browser Back; cancelled POP navigation first restores the
original URL. A completed draft edit is not a completed project save. Draft URLs support reload/recovery;
server retention does not make the draft a saved/listed project. Existing saved projects are preserved by an additive
schema migration with a pre-migration SQLite backup.

## Audio engine scope

Synthesis, realtime playback, clip loops and OfflineAudioContext WAV export stay in the browser. There is no
backend mix-render service or realtime audio streaming. Backend audio jobs are optional generation and analysis
adapters, independent of the playback graph.
