<h1 align="center">Demotif</h1>

<p align="center">An AI music creation workspace.</p>

Demotif combines a browser music studio with a conversational producer. Arrange reusable clips, edit notes and drum patterns, import audio, mix tracks, and export WAV. The producer proposes reversible edits for review before they enter the project.

## Studio

Vocal editors support [lyric-guided microphone reference recording](docs/vocal-recording.md), take review/re-record, WAV download and explicit saving into the current draft. Live pitch correction, authentication, and hosted deployment remain future work.

## Development

Requires Node.js 24+ (including native `node:sqlite`). The application is Next.js 16 App Router with React, TypeScript, Tailwind v4 and shadcn/Base UI. Next.js serves both the workspace and `/api`; no separate API server is required.

```bash
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). Run `npm run build` and `npm start` for a production build. `npm test` runs browser-audio and server tests; `npm run typecheck` checks both sides. Run `npm run lint` for lint checks.

Copy `.env.example` to `.env.local` for optional services. Producer configuration uses `DEMOTIF_PRODUCER_MODEL`, `DEMOTIF_PRODUCER_API_KEY`, optionally `DEMOTIF_PRODUCER_BASE_URL`, and `DEMOTIF_PRODUCER_API=chat` or `responses`. Vercel AI SDK and its OpenAI-compatible provider run only on the server; tools stage typed edits for review. Credentials must never use `NEXT_PUBLIC_` names.

SQLite, media and optional example packs live under `data/`; back up the database and media together. Relative storage settings resolve against the repository root. Example manifests use `data/examples/<id>/manifest.json`; Pocket groove is built in. Additional songs/media are local data, not distributed with the source.

## Existing local installations

Stop the old API before switching writers. Run the one-time copy command before starting Next.js:

```bash
npm run migrate:local -- /path/to/legacy-server
```

It copies the old database with SQLite's backup API, copies media/examples without replacing existing destination files, and copies the legacy server environment to ignored `.env.local` if that file does not exist. Original files remain intact. The destination database is never overwritten. The new server also creates `data/demotif.db.pre-nextjs.bak` before its first database initialization. Do not run the old API against the active database concurrently. Custom absolute storage paths should be checked separately before cutover.

## Optional transcription

Only this offline tool needs Python 3.13; the web application and producer do not.

```bash
uv sync --project analysis
uv run --project analysis pytest
```

Install ffmpeg, and optionally set `DEMOTIF_ANALYSIS_PYTHON` to the analysis environment's Python executable. The default is `analysis/.venv/bin/python`. Analysis is bounded to 30 seconds and is independent of playback timing.

Project JSON does not embed media: references must exist in the local workspace. Audio imports accept up to eight files per batch, each up to 60 MB and five minutes. Recordings retain their original speed when tempo changes.

Third-party attribution is retained in `resources/sounds/catalog.json`, `resources/licenses/`, and `branding/OFL.txt`. See [architecture](docs/architecture.md) for runtime boundaries, persistence, and command semantics.
