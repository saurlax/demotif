# Demotif — agent guide

Demotif is a browser-based AI music workspace: a conversational producer edits an explicit project model while the
browser owns real-time audio.

## Layout

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui (`base-nova`, Base UI primitives).
- `backend/` — Python 3.13 + FastAPI + SQLAlchemy 2 (async) + SQLite. Local media in `backend/data/` (gitignored).
- `openspec/` — spec-driven change proposals and specs. Agent integrations live in `.agents/skills/`.
- `docs/architecture.md` — runtime boundaries, data model, command protocol, migration seams.

## Commands

```bash
# backend (port 8200; 8000–8197 are inside a Windows excluded port range on this machine)
cd backend && uv run uvicorn app.main:app --port 8200

# frontend (port 5173, proxies /api to 127.0.0.1:8200)
cd frontend && npm run dev

cd frontend && npm run build      # tsc -b && vite build
cd backend && uv run pytest       # command protocol tests
```

## Invariants

- The project document is the source of truth. The browser never invents state the server has not accepted.
- Every edit is a typed, validated `ProducerCommand` with `expected_version`; the server enforces version checks and
  rejects edits that touch locked tracks/clips. Revisions are append-only; undo writes a new version.
- Real-time audio (transport, metronome, recording, monitoring, pitch detection) stays in the browser. Agent/network
  latency must never gate recording start.
- Generation providers are separate from editing and playback. Never couple the DAW audio graph to a provider SDK.
- Local adapters stand in for future hosted services: local filesystem ↔ object storage, SQLite ↔ Postgres,
  `FakeProducer` ↔ real agent (a13n harness integration is pending an exact package/repo from the user).

## OpenSpec workflow

Use the `openspec-*` skills in `.agents/skills/`. For non-trivial work, propose a change first:

```bash
openspec list
openspec validate <change>
openspec archive <change>
```

Keep proposals small, state which boundary they touch (browser audio / server model / provider), and name the
invariants above when they apply.

## Style

- TypeScript: strict, `erasableSyntaxOnly` (no parameter properties / enums), path alias `@/`.
- Python: type hints on public functions, Pydantic for boundaries, services own transactions.
- Do not add dependencies that are not used by the current change.
