# Design

## Context
The existing synchronous SQLite Store already atomically persists documents, typed commands, reversible deltas, receipts and independent draft saves. Moving those rows to a separate database adds no value for a single backend. Local and hosted applications must reach that same backend, rather than independently writing two SQLite databases.

## Goals / Non-Goals
One authoritative workspace and durable object-backed binaries. Preserve version checks, locks, draft isolation, append-only undo, native worker protocols and browser audio. No PostgreSQL, project file format, per-edit full snapshots in S3, network-mounted SQLite, multiple backend owners or automatic destructive retention.

## Decisions
### SQLite owns structured state
Keep project JSON in projects.document; save checkpoints remain in draft_checkpoint. operations stores forward/inverse structural deltas and undo relationships, not a complete document for each edit. Retain legacy revisions read-only. Initial/baseline and explicit Save checkpoints are permitted database snapshots; ordinary edits do not create full snapshots. Existing delta replay and inverse undo remain authoritative. Keep receipts and accepted content in the same BEGIN IMMEDIATE transaction. Database backup and referenced object backup are both needed for recovery.

### One backend owns the database
A configured server-side upstream API proxy forwards all API requests, including streams and uploads, before opening local SQLite or starting workers. No automatic local fallback. Use the existing route structure and relative browser URLs. Forward method, query, content headers and stream bodies; remove hop-by-hop headers and preserve cancellation, status, range and SSE semantics. Use a Next.js Node API route adapter to retain verified Content-Length headers: the installed App Route response sender strips them. Disable framework body parsing and use no-transform for byte ranges and SSE. Credentials remain server-only. Only the authoritative process recovers interrupted tasks; multiple frontends do not require distributed leases.

### S3 stores binaries
An injected server adapter uses scoped immutable SHA-256 object keys and private SDK credentials. Upload and verify size/digest before publishing a reference in SQLite. Keep project-owned asset IDs distinct while sharing bytes. Ordinary project edits never contact S3. Failed publication can leave unreferenced bytes, never a ready partial asset. No automatic shared-object deletion.

Serve private objects through existing project-ownership checked API routes. Preserve HEAD, conditional requests, single ranges, length/type, 416 and cancellation. Native inputs materialize from object references into digest-verified disposable caches through atomic writes. Never equate a missing cache with a missing durable render. Installed model weights, dictionaries, scalers, reports and licenses have portable catalogs; executable environments remain installed runtime components. Catalog metadata lives in SQLite; binaries live in S3.

### Publication boundaries
All network I/O occurs outside synchronous SQLite transactions. Prepare object-backed assets asynchronously; transaction callbacks only insert ownership/bindings. Keep the synchronous Store and pure project/history transforms. Re-check cancellation and captured job state after upload and before publication. Browser recording starts locally; browser WAV export retains download and uploads the captured version's mix without implicit Save.

### Migration and recovery
Take consistent SQLite backups and inventory every referenced file. Upload and hash-verify binaries first; publish metadata only after verification. Merge local-only content through a provenance ledger; divergent equal project IDs remap the complete dependency graph instead of choosing a higher version. Preserve drafts, operations, receipts, conversations, renders and mute/lyric/timing data. Support resume and dry-run, retain originals, and verify accepted content before activation. Point local proxy at the authoritative backend only after import. Operational endpoints and deployment execution remain private.

## Risks / Trade-offs
- A single backend is a deliberate availability boundary; outages must not report local success.
- SQLite needs a persistent volume and one owner. Scale-out requires a future database migration.
- SQLite and S3 are not one transaction. Verify binaries first, commit their visibility second, and retain unreferenced candidates for explicit cleanup.
- Native caches can be large. Hash verification and on-demand materialization preserve truthful readiness after disk loss.

## Migration Plan
Implement adapters/proxy and caller publication boundaries; verify tests and real object operations; inventory and back up both sources; migrate binaries and relational records; reconcile writers; activate the shared backend/proxy; verify playback, Save conflicts, undo and exports. Keep rollback sources.

### Direct browser transfers
The server issues short-lived GetObject/HeadObject credentials for only an owned asset or built-in preview object. Upload reservations capture filename, type, size, Content-MD5 and optional export version in SQLite; credentials allow PutObject only to one unique staging key. COS validates Content-MD5. Completion checks size and ETag, performs a conditional COS-internal copy to a unique immutable final key unavailable to upload credentials, then commits asset ownership/export metadata. Retry completion is idempotent. Server inference and cache reconstruction continue using server SDK access. Permanent credentials never enter client bundles; temporary credentials remain in memory and no-store responses. CORS must allow the participating browser origins and required methods/headers while retaining existing bucket rules. Actual origins and deployment configuration remain private.
