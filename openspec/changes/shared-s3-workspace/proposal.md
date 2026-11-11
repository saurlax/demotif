# Proposal

## Why
Local and hosted runtimes need one shared music workspace without introducing a second database service or serializing an entire project for each edit. Existing SQLite transactions and operation deltas already implement the required editing semantics.

## What Changes
- Keep one authoritative SQLite database owned by one backend. Store current project documents, independent drafts, forward/inverse operation history, checkpoints, receipts, conversations, jobs and ownership there.
- Local frontends/services access that backend through the existing API using an optional server-side upstream proxy. Never share SQLite over a network filesystem or silently fork a local database when upstream fails.
- Move durable audio, recordings, generated vocals, built-in/example media, installed voice artifacts and exports into private S3-compatible storage. Browser uploads/downloads use exact-object STS sessions and go directly to object storage; the backend handles metadata and server-side jobs. Local disk holds replaceable caches and native working files.
- Upload and verify immutable binaries before short SQLite publication transactions. No project file format, project objects, S3 database, PostgreSQL or distributed job scheduler.
- Preserve expected versions, locks, append-only undo, explicit Save and browser-owned recording/playback/mixing.
- Provide resumable verified migration, retaining divergent source identities and original backups.
- Keep all private deployment details and credentials outside specs and source control.

## Capabilities
### New Capabilities
- `shared-workspace-persistence`: One SQLite-owning backend, API sharing, transactional projects and incremental history.
- `object-media-storage`: Private binary storage, streaming, catalogs and verified native caches.
- `workspace-storage-migration`: Collision-safe import, integrity verification and recoverable cutover.
### Modified Capabilities
None. Preserve the existing vocal contracts.

## Impact
Server storage, media, catalogs, native inputs, export persistence, API proxy and migration tooling. Add only the used S3 SDK dependency. Browser DSP stays unchanged. SQLite requires durable local storage and a single backend owner; replicas and offline shared editing are non-goals.
