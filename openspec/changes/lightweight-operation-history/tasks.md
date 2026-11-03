# Tasks

## 1. Lightweight reversible operations

- [x] 1.1 Add operation-history storage and typed internal forward/inverse deltas for every existing command, including stable IDs and deletion positions; verify lock payload size is independent of unrelated project content and all scalar/entity operations round-trip through focused backend tests.
- [x] 1.2 Implement atomic compare-and-swap mutation transactions and append-only sequential undo; verify independent concurrent sessions, lock rejection, failed-command rollback, repeated undo to exhaustion, edit-after-undo, and restart persistence with backend tests.

## 2. Legacy migration and API compatibility

- [x] 2.1 Implement transactional idempotent legacy conversion, baseline markers, consistency checks, and local pre-migration backup; verify file-backed legacy fixtures with rename, clips, deleted tracks, prior undo transitions, interrupted migration, and repeated startup, with unchanged current documents and no duplicate metadata.
- [x] 2.2 Route project creation, reads, command/undo responses, and history metadata through the new history service and expose can_undo; verify fresh and migrated API response shapes and absence of new full historical snapshots using integration tests.
- [x] 2.3 Update architecture documentation with history format, undo semantics, retained legacy snapshots, backup/rollback, and the remaining current-document write cost; verify descriptions against tested behavior and reconcile conflicting snapshot-specific wording.

## 3. Client integration and verification

- [x] 3.1 Consume actual can_undo in frontend contracts and controls, preserving hidden version numbers; verify backend exhaustion disables Undo, lock/undo works, and Producer proposals use the same conflict-protected command path in the browser.
- [x] 3.2 Run backend uv run pytest and frontend npm run build, record actual storage-size comparison for a lock operation on small and large unrelated projects, and manually verify an existing local project plus a disposable test project without altering original music content.
