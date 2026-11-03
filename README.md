<h1 align="center">Demotif</h1>

<p align="center">An AI music creation workspace.</p>

Demotif combines a browser music studio with a conversational producer. Arrange reusable Clips, edit notes and drum patterns, import audio, mix tracks, and export WAV. The producer proposes reversible edits for review before they enter the project.

## Studio

Microphone recording, live pitch correction, account isolation, and hosted deployment remain future work. Audio generation and the real producer require server configuration; unavailable capabilities are shown explicitly.

## Development

Requires Node.js 20.19+ and Python 3.13 with [uv](https://docs.astral.sh/uv/).

```bash
# terminal 1
cd backend
uv sync
uv run uvicorn app.main:app --port 8200

# terminal 2
cd frontend
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). Vite proxies `/api` to port 8200. SQLite and media stay under `backend/data/`; back up both together. No browser database or external service is required for playback, editing, and export.

For the real producer, install `uv sync --extra producer` and configure `DEMOTIF_PRODUCER_MODEL`, `DEMOTIF_PRODUCER_API_KEY`, and optionally `DEMOTIF_PRODUCER_BASE_URL` in `backend/.env`. The verified SDK is `a13n-harness==0.21.0`, supporting OpenAI Responses and Chat Completions compatible endpoints (`DEMOTIF_PRODUCER_API=responses` or `chat`). Only project/audio tools are exposed.

```bash
cd backend && uv run --all-extras pytest
cd backend && uv run ruff check app tests
cd frontend && npm test
cd frontend && npm run build
```

Project JSON imports create a new project. Referenced audio must already be available in the same local workspace; JSON does not embed media. Audio imports accept up to eight files per batch, each up to 60 MB and five minutes. Source recordings remain at their original speed when project tempo changes.

Third-party sample attribution is retained in `backend/resources/sounds/catalog.json` with license texts in `backend/resources/licenses/`. See [architecture](docs/architecture.md) for state authority, command history, runtime boundaries, and adapter seams.

Example packs are read from `backend/data/examples/<id>/manifest.json` (or `DEMOTIF_EXAMPLES_ROOT`). Pocket groove is built in; additional packs and their media are local data and are not distributed with the source. Opening an example creates an unlisted draft, not a saved project.
