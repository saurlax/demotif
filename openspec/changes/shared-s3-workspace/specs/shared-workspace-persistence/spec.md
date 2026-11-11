## Purpose
Share one authoritative SQLite workspace through one backend API while preserving accepted editing and history semantics.

## ADDED Requirements
### Requirement: Keep one authoritative backend
Configured local and hosted frontends SHALL access the same SQLite-owning backend through the API. A proxy SHALL forward requests before opening a local database or starting workers. Database files SHALL NOT be shared over a network filesystem.
#### Scenario: Read an edit from another frontend
- **WHEN** one frontend acknowledges an edit and another subsequently reads it
- **THEN** both observe the same backend-accepted project version
#### Scenario: Upstream is unavailable
- **WHEN** the configured backend cannot be reached
- **THEN** the proxy reports failure without writing an independent local database

### Requirement: Store projects and incremental history in SQLite
Current project documents, independent drafts, checkpoints, operations, receipts, conversations and jobs SHALL remain in SQLite. Ordinary edits SHALL append forward/inverse deltas rather than full project snapshots. No project file format or S3 project document SHALL be introduced. Legacy revisions SHALL remain readable.
#### Scenario: Edit and undo
- **WHEN** an accepted edit is undone
- **THEN** inverse history produces a new version and retains prior operations without creating a full project file

### Requirement: Preserve transactional editing
Typed validation, expected versions, locks, receipts and append-only history SHALL commit atomically. Explicit Save SHALL check the saved base version and atomically update base and draft checkpoint. Uploading or rendering SHALL NOT implicitly save a draft.
#### Scenario: Competing draft saves
- **WHEN** two independent drafts save against the same base version
- **THEN** the second save conflicts and retains its dirty draft
#### Scenario: Fail a transaction
- **WHEN** a transaction fails
- **THEN** accepted project content and history remain unchanged

### Requirement: Preserve streams and browser audio
The upstream proxy SHALL preserve uploads, range responses, ordered resumable SSE and cancellation. Browser recording, monitoring, transport and mixing SHALL remain browser-owned.
#### Scenario: Storage outage while recording
- **WHEN** the user starts recording while storage is unavailable
- **THEN** recording starts locally and persistence failure is reported without claiming a durable save
