# Demotif architecture (local-first)

Status: early skeleton. The repository now runs a full vertical slice: create a project, add tracks, chat with a
stand-in producer, apply validated commands, lock sections, and undo. Audio recording/generation are not wired yet.

## Runtime boundaries

```text
┌──────────────────────────── browser ────────────────────────────┐
│ Studio UI (React)        Audio engine (Web Audio/AudioWorklet)  │
│  arrangement, mixer       transport clock, metronome, recording  │
│  producer chat            monitoring, pitch detection, preview   │
└───────────────┬─────────────────────────────────────────────────┘
                │ /api (typed commands, JSON)
┌───────────────▼─────────────────────────────────────────────────┐
│ Python API (FastAPI)                                            │
│  project document · version CAS · revision log · assets         │
│  producer adapter (fake now → a13n harness later)               │
│  generation adapters (later; never in the audio path)           │
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
│  │  │  └─ studio/                 # arrangement, producer chat, transport, top bar
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
│  │  ├─ models/project.py          # Project, Revision, Asset
│  │  ├─ schemas/                   # document, command, project, asset, agent DTOs
│  │  ├─ services/                  # project + command (transactions)
│  │  └─ adapters/
│  │     ├─ agent/                  # Producer protocol + FakeProducer
│  │     └─ storage/                # LocalBlobStore
│  ├─ tests/                        # command protocol tests
│  └─ pyproject.toml                # uv-managed
├─ openspec/                        # specs + change proposals
├─ .agents/skills/                  # OpenSpec skills (vendor-neutral)
├─ docs/architecture.md
├─ AGENTS.md
└─ README.md
```

Next directories to grow (not created until needed): `frontend/src/audio/` (engine, worklets, analysis),
`frontend/src/features/{recording,mixer,pitch,assets}/`, `packages/contracts/` (generated OpenAPI types).

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
`clip.add`, `clip.move`, `clip.remove`.

The producer (`POST /projects/{id}/messages`) returns `{ reply, commands }` and does **not** auto-apply. The UI shows
the proposed edits and applies them through the command endpoint, preserving explicit user approval.

## Adapter seams (hosted migration)

| Concern | Local | Hosted target | Seam |
| --- | --- | --- | --- |
| Project DB | SQLite (`aiosqlite`) | Postgres (`jsonb` document) | SQLAlchemy session + `DATABASE_URL` |
| Media | `LocalBlobStore` | Signed object storage | storage adapter interface |
| Producer | `FakeProducer` | a13n harness / hosted agent | `Producer` protocol |
| Generation | none | provider APIs | separate service; outputs become assets |
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

## Roadmap

1. Confirm the exact **a13n harness SDK** (package/repo/docs) and implement `adapters/agent/a13n.py` behind `Producer`.
2. Audio engine slice: AudioContext lifecycle, transport clock, metronome/count-in, Web Audio graph for clips.
3. Recording: microphone capture, latency compensation, takes as assets, comping.
4. Pitch: YIN/CREPE analysis, correction preview, then vocal synthesis providers.
5. OpenSpec changes for each slice; add Alembic when the schema starts evolving.
6. Hosted migration only after the local workflow is solid.


## Workspace UI source

The shell derives from official shadcn/ui sidebar-15, Base UI/base-nova: https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json (retrieved 2026-11-03). AppShell retains SidebarProvider, SidebarLeft, SidebarInset/header, and SidebarRight. Left header/content/rail and right sticky full-height bordered panel follow the block. Demo teams/favorites/workspaces become actual project navigation and disabled future library entries; calendar/account content becomes Producer. Narrow screens use Sheet with conversation state owned above responsive panels. Height/overflow constraints adapt the center to a DAW viewport. Neutral theme tokens replace purple, keeping timeline semantic colors. No new dependencies or server contracts.


## Lightweight operation history

Each accepted command updates the authoritative Project document once and writes only its forward/inverse deltas to Operation. Scalar deltas contain a stable-ID path and value; insert/remove/move deltas preserve entity identity and order. Deleted tracks retain their own subtree for restoration, without unrelated tracks. Creation is a non-undoable baseline. A lock history payload is independent of unrelated project size. The current document is still validated, diffed, and written, so this does not make every edit constant-time or remove project-sized processing.

Updates use database compare-and-swap on project ID and expected_version in the same transaction as history insertion. The internal monotonic counter stays in APIs for stale-edit protection and is not displayed. ProjectRead.can_undo reports actual remaining active history. Undo walks backward through ordinary operations, skips already compensated operations, and remains correct after restart or an edit following undo. Ordinary commands retain locked-section validation; undo restores server-owned prior values through internal deltas, not unrestricted client restoration commands.

Startup backs up a legacy SQLite database using SQLite's backup API before schema/history changes, to backend/data/demotif.db.pre-operations-<UTC timestamp>.bak. An additive operations table is created, then adjacent legacy snapshots are converted transactionally. The baseline entry doubles as a completed-migration marker. Missing revisions, inconsistent current state, or invalid deltas abort conversion without a partial project history. Restarting does not duplicate entries or backup completed migrations. Original Revision rows remain untouched; old snapshot undo transitions are imported as actual historical transitions, and subsequent undo uses the new compensation semantics. No historical snapshot pruning is performed. Do not run an old server writer against a migrated database. To roll back, stop the server and restore both the pre-migration database backup and matching code. Hosted storage/provider seams are unaffected.

## Arrangement clip presentation

The clip layout follows the distinction between pattern-note and audio previews in FL Studio's Playlist: https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/playlist.htm . Track rows are 52px, clip bodies 44px, with a small title strip and restrained border. The previous random capsule bars were decorative, not waveform/note data, and are removed. Clips with no source show Empty clip; sourced clips identify Audio or MIDI until real waveform/note data is available. No fabricated notes are inserted into the project model.
