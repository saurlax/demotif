<h1 align="center">Demotif</h1>

<p align="center">An AI music creation workspace.</p>

**Compose through conversation, humming, and precise editing.**

Demotif is a browser-based workspace for developing musical ideas with an AI producer. Start with a melody, a lyric, or a recording, then shape the arrangement and vocal performance through an editable project. Keep the parts you like and refine the rest.

> Early development. A local vertical slice now runs: project creation, track arrangement, a producer chat that
> proposes typed edits, server-side validation with locked sections, revision history, and undo. Audio recording,
> playback, pitch work, and generation are the next slices. Hosted deployment is deferred.

## Create with an AI producer

- **Speak and sing.** Describe a change or sing a phrase to express a musical idea directly.
- **Work on a phrase.** Revise a melody, lyric, or instrument part while preserving approved sections.
- **Shape the performance.** Develop vocals from recordings, MIDI, and lyrics, with support for an authorized personal voice.
- **Stay in control.** Inspect edits, compare versions, and undo changes within the same project.

## From an idea to a track

1. Record a short melody or bring existing lyrics and audio.
2. Develop an arrangement with the AI producer.
3. Listen, select a phrase, and describe or sing the next revision.
4. Refine notes, timing, tracks, and vocal expression in the browser.
5. Save the project and export the result.

## Project architecture

| Component | Responsibility |
| --- | --- |
| Browser studio | Audio capture, multitrack playback, MIDI editing, and project interaction |
| Producer agent | Conversational guidance and structured editing tools |
| Audio services | Transcription, melody extraction, generation, vocal synthesis, and rendering |
| Project storage | Recordings, generated assets, project state, and revision history |

The project model is the source of truth. Agent actions operate on explicit tracks and clips, respect locked sections, and produce reversible edits. Generation providers are separate from editing and playback.

## Development

Requires Node.js 20.19+ and Python 3.13 with [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/saurlax/demotif.git
cd demotif

# terminal 1 — API on http://127.0.0.1:8200
cd backend
uv sync
uv run uvicorn app.main:app --port 8200

# terminal 2 — studio on http://localhost:5173
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend. Port 8200 is used because 8000–8197 fall inside a Windows
excluded port range on the primary development machine; override with `DEMOTIF_*` settings if needed.

```bash
cd backend && uv run pytest       # command protocol + producer tests
cd frontend && npm run build      # typecheck + production build
```

The repository uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven changes. Agent integrations
are committed under `.agents/skills/` (vendor-neutral) and conventions live in `AGENTS.md`.

See [`docs/architecture.md`](docs/architecture.md) for runtime boundaries, the Producer Command Protocol, the
adapter seams for a future hosted deployment, and the current roadmap.
