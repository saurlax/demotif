## Purpose

Move existing SQLite/filesystem workspaces into shared SQLite records and S3 binary objects without losing musical content, history or recovery options.

## ADDED Requirements

### Requirement: Inventory a consistent source workspace
Migration SHALL inventory consistent SQLite source records and every referenced managed file before cutover to SQLite and S3. Inventory SHALL include saved projects, drafts, checkpoints, history, receipts, conversations/events, jobs, catalogs and installed voice manifests. Credentials and work-directory temporaries SHALL be excluded.

#### Scenario: Inventory existing saved and unsaved work
- **WHEN** local and hosted sources are inspected for migration
- **THEN** the report distinguishes their saved projects, independent drafts, histories, job results and referenced binaries without dropping unsaved accepted content

### Requirement: Preserve divergent source identities
Migration SHALL preserve both sources when equal identifiers represent divergent records. It SHALL remap the affected relationship graph consistently and SHALL not resolve divergence solely by name or larger version number. Identical verified records and immutable bytes can deduplicate without merging independent histories.

#### Scenario: Import two different projects with one identifier
- **WHEN** source workspaces contain divergent projects with the same identifier
- **THEN** both projects survive the import with valid draft/base, history, asset, run and job relationships and recorded provenance

### Requirement: Verify imported integrity before visibility
Migration SHALL verify S3 binary hashes/sizes, project JSON validation, SQLite record counts/relationships and reversible history before activation. History SHALL remain database-managed as forward/inverse deltas. Missing or corrupt referenced content SHALL prevent a successful cutover report.

#### Scenario: Encounter a missing cached vocal file
- **WHEN** a source claims a ready vocal result whose required audio cannot be recovered and verified
- **THEN** migration reports the discrepancy and does not advertise that missing result as a successfully migrated ready render

#### Scenario: Validate an imported draft
- **WHEN** a draft and its operations have been imported
- **THEN** its accepted lyrics, notes, track mute states, saved checkpoint and undo behavior match the verified source or an explicit recorded identity remapping

#### Scenario: Reopen imported legacy revisions
- **WHEN** a retained source revision is migrated
- **THEN** its database revision/history relationships identify a valid project snapshot and its historical content remains readable without relying on the source SQLite file

### Requirement: Resume interrupted migration safely
Migration SHALL record verified progress so an interrupted transfer/import resumes without duplicating logical projects, history or objects. S3 uploads and inactive SQLite import records SHALL be distinguishable from a successfully activated workspace.

#### Scenario: Restart after partial transfer
- **WHEN** a migration is restarted after some verified objects were uploaded
- **THEN** it reuses valid completed work, transfers remaining content and publishes no partial workspace as complete

### Requirement: Cut over both runtimes consistently
Final migration SHALL reconcile writes at a controlled cutover and configure frontends for the same SQLite-owning backend and S3 workspace. It SHALL verify shared reads, edits, Save conflicts and playback before reporting completion. Original sources SHALL remain recoverable until separately authorized cleanup.

#### Scenario: Edit after cutover
- **WHEN** an edit is acknowledged through one configured runtime after cutover
- **THEN** another configured frontend reads that edit and cannot silently save a stale competing state over it

#### Scenario: Recover after a cutover failure
- **WHEN** verification fails during cutover or a rollback is required after new shared edits
- **THEN** recoverable source snapshots, SQLite records and referenced S3 binary objects remain available and no accepted post-cutover edit is silently discarded
