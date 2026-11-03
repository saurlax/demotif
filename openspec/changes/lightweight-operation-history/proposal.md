# Proposal

## Why

Every accepted edit currently inserts the entire project document into Revision, including a single lock toggle. Replace this growing snapshot history with reversible operation records while keeping conflict protection and undo, as explicitly requested by the user.

## What Changes

- Store forward and inverse changes scoped to affected fields or entities instead of new whole-project historical snapshots.
- Keep one current project document and the internal monotonic concurrency counter; neither counter nor history implementation appears as a user-facing version feature.
- Make repeated undo traverse prior active operations instead of undoing the previous undo.
- Preserve existing project data and historical states through a tested, idempotent migration.
- Enforce conflict checks atomically at database update time and expose actual undo availability to the UI.

## Capabilities

### New Capabilities

- `project-history`: Lightweight persistent edit history, sequential undo, concurrency protection, and legacy-history compatibility.

### Modified Capabilities

None. The previous workspace change has no history-specific delta and there are no main specs yet.

## Impact

Touches the server-model and local database-adapter boundaries, plus API contracts and frontend undo availability. Keeps typed commands, locked-section protection, append-only audit history, browser-local audio, and provider separation. Affected files include backend models, services, startup migration, schemas, tests, frontend contracts/undo controls, and docs/architecture.md.

Non-goals: redo UI, named versions, history browser, collaborative merges, history pruning, audio-engine changes, and performance claims unsupported by measurements. The current project JSON still updates on each accepted edit; this change removes historical full-document duplication rather than all project-sized work.
