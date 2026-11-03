# Design

## Context

See proposal.md. apply_command currently writes Project.document plus a full Revision.document on every command. undo_last_change reads version-1, so repeated undo can oscillate. The request-level version check is not an atomic database compare-and-swap. Startup only calls create_all; tests use fresh in-memory schemas. RevisionRead exposes metadata only. StudioPage derives canUndo from version > 1, which cannot represent a consumed undo stack.

## Goals / Non-Goals

Goals: bounded field-change history for scalar edits, durable sequential undo, compatible old project/history reads, and atomic conflict rejection.
Non-goals: replacing the authoritative project JSON, implementing redo, deleting old audit records, hosting migration, or guaranteeing constant-time processing of large documents.

## Decisions

1. Add an operation-history table, leaving legacy Revision rows untouched. Each row stores project ID, unique project/version, summary, timestamp, forward delta, inverse delta, and optional undo_of. Index project/version and undo_of. Entries are append-only; undo appends a compensating operation linked to its target. Keep Project.version as the internal concurrency token and Project.document as current state. New project creation does not write a full snapshot revision.
2. Use a small typed internal delta vocabulary for scalar changes and ordered track/clip insertion/removal. Entity operations carry stable IDs and original insertion positions; deletion inverse carries only the removed subtree, not unrelated tracks. Generate UUIDs once on addition. Capture project-name changes alongside document edits. No generic positional array replacement or external patch dependency. Public ProducerCommand stays separate from internal restore operations so clients cannot inject unrestricted restoration payloads.
3. Undo selects the latest ordinary operation not already targeted by an undo event; undo events never become new undo targets. Apply the stored inverse to current state and append its forward/inverse compensation. An edit after undo appends a new ordinary operation. Undo order is persistent across restart. Validate restored documents; lock toggles remain undoable, while normal edit commands still enforce track/clip locks.
4. Update Project through an atomic UPDATE constrained by id and expected_version and increment the counter in that statement; append history in the same transaction. Zero matching rows yields VersionConflictError and rolls back all writes. Validate against the loaded state, then rely on CAS to reject any intervening write. Use the same rule for undo; normalize concurrent SQLite writer failures to the documented conflict behavior where applicable, never partial success.
5. Migrate legacy history transactionally into operation entries by diffing adjacent snapshots, including separate project names, preserving entity IDs/order and metadata versions. Treat historical transitions, including historical undo transitions, as imported ordinary operations: future undo walks those actual historical states in reverse; new undo events use undo_of. Initial creation is a non-undoable baseline marker. Existing legacy snapshots stay read-only for compatibility; migration changes neither current project state nor its version. A migration marker and unique project/version make retries idempotent. Missing/inconsistent legacy history aborts that project's migration with actionable diagnostics rather than silently discarding undo. Back up the local database before migration and verify snapshot-chain end equals the current document/name.
6. Keep command/undo response revision metadata shapes and expected_version inputs; list-history returns operation metadata (including imported rows) without duplicating legacy rows. Add can_undo to ProjectRead and consume it in StudioPage/types. Keep all user-facing version numbers removed. Producer messaging still checks expected_version. No provider or browser audio changes.

## Risks / Trade-offs

- A removed track may contain many clips -> store that necessary subtree; verify no unrelated project content is included.
- Legacy migration reads historical documents -> perform once, transactionally and with backup; ordinary edits never replay all history.
- Startup create_all cannot migrate existing columns -> use additive new tables plus explicit migration service, not implicit column changes.
- Old server code cannot safely write after operation-history adoption -> rollback by restoring the pre-migration database backup and matching code, never run mixed writers.
- Internal counter remains -> explain it protects accepted edits; it is not a visible version-management feature.

## Migration Plan

Affected backend files: app/models/project.py, new app/services/history.py and app/db/migrations.py, app/services/command.py and project.py, app/main.py, app/schemas/project.py, tests/test_commands.py plus migration/concurrency tests. Frontend: src/types/project.ts and features/studio/studio-page.tsx. Update docs/architecture.md with operation format, undo semantics, migration/backups, and explicit legacy snapshot retention. Reconcile AGENTS.md/config wording only where it inaccurately mandates full snapshots; append-only history and optimistic concurrency remain. No hosted storage adapter migration is involved.
