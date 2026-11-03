# Demotif backend

FastAPI service that owns the project document, the Producer Command Protocol, revision history, and asset metadata.

```bash
uv sync
uv run uvicorn app.main:app --port 8200
uv run pytest
```

- SQLite + local media live in `data/` (gitignored); configure via `DEMOTIF_*` variables or `.env` (see `.env.example`).
- The producer adapter is a deterministic `FakeProducer` until the a13n harness SDK is confirmed.
- See `docs/architecture.md` at the repository root for boundaries and the hosted-migration seams.
