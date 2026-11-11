## Purpose

Store durable music media and musical resource artifacts in private object storage while preserving browser playback, export and native inference through replaceable local caches.

## ADDED Requirements

### Requirement: Store every durable musical binary in object storage
Uploaded audio, recordings, provider output, vocal renders, example audio and built-in audio SHALL have verified object-backed content. Operator-installed voice weights, dictionaries, scalers and validation/provenance resources SHALL have portable durable object references. Runtime caches SHALL not be their only copy.

#### Scenario: Lose a completed render's local cache
- **WHEN** local cached files are removed after a vocal render was committed
- **THEN** its accepted audio remains accessible through object storage without forcing a new inference

#### Scenario: Open a built-in sound or example from a clean runtime
- **WHEN** the runtime has no prior musical resource cache
- **THEN** it can read the published catalog and obtain its verified audio from object storage

### Requirement: Publish only complete owned assets
An asset SHALL become available to project commands and ready job bindings only after its S3 bytes are verified and SQLite commits its ownership and binding records. Shared physical objects SHALL preserve distinct project-owned asset identities and existing ownership validation.

#### Scenario: Fail an audio upload
- **WHEN** S3 upload or the following SQLite publication transaction fails
- **THEN** no playable asset or ready render is advertised for the incomplete operation

#### Scenario: Clone a rendered draft
- **WHEN** rendered audio is reused by a copied project or independent draft
- **THEN** the copy has valid owned asset references without duplicating or losing immutable audio content

### Requirement: Preserve media streaming semantics
Direct browser object access SHALL preserve content type, byte length, HEAD, valid single-byte ranges, invalid-range responses and conditional cache behavior. Aborted requests SHALL release their upstream resources. Browser audio decode, seek and export SHALL use the same accepted content.

#### Scenario: Request part of a stored recording
- **WHEN** a client requests a valid byte range for an owned asset
- **THEN** it receives the matching bytes, partial-content status and correct range and length headers

#### Scenario: Reject an invalid range or foreign reference
- **WHEN** a request has an invalid byte range or references an asset outside the requested project
- **THEN** it receives the existing range or ownership error rather than unrelated object bytes

### Requirement: Materialize native inputs portably
Native synthesis and analysis SHALL obtain verified local inputs from portable object references. A clean compatible runtime SHALL reconstruct required model resources and inputs without depending on another machine's absolute paths. Corrupt artifacts or missing compatible runtimes SHALL not be reported ready.

#### Scenario: Synthesize with an empty native cache
- **WHEN** a compatible worker claims a job whose model artifacts are durably installed but uncached locally
- **THEN** it verifies and materializes those artifacts before native inference while preserving the captured model fingerprint and score timing

#### Scenario: Detect a changed model artifact
- **WHEN** a cached or downloaded artifact does not match its manifest digest
- **THEN** inference or readiness fails with an actionable error rather than using unverified weights

### Requirement: Keep permanent credentials server-only
The system SHALL use private server configuration for database and object-storage authentication and SHALL not expose permanent credentials in client bundles, media URLs, logs, source control, reports or musical manifests. Normal playback SHALL not require a public bucket; direct-transfer CORS SHALL retain unrelated bucket rules.

#### Scenario: Inspect the client and media response
- **WHEN** a user loads the application or requests project audio
- **THEN** browser code contains no permanent database/storage credentials, while short-lived exact-object STS credentials enable authorized direct media access

### Requirement: Persist generated exports explicitly
A successfully persisted mix SHALL be stored in S3 with a SQLite binding to its captured accepted project version, while mixing and WAV encoding remain browser-owned. Merely downloading a local file SHALL not be reported as successful shared export persistence.

#### Scenario: Export from one runtime and access from another
- **WHEN** the user completes a browser mix export and its upload is acknowledged
- **THEN** another runtime can retrieve the same export bytes and identify the captured project version without an implicit project Save

#### Scenario: Fail export persistence
- **WHEN** browser rendering succeeds but its export upload fails
- **THEN** the local download can remain available and the system reports that the shared export was not durably saved

### Requirement: Transfer browser binaries directly with scoped STS
Browser uploads, recordings, previews, playback and mix exports SHALL transfer directly between the browser and object storage. The server SHALL issue only short-lived exact-object permissions after validating project ownership or built-in resource membership. Server APIs SHALL NOT proxy browser binary transfers or accept client-chosen arbitrary object keys.
#### Scenario: Request a foreign asset
- **WHEN** a session request names an asset owned by another project
- **THEN** the server denies it without issuing credentials
#### Scenario: Upload and publish
- **WHEN** a browser finishes a reserved staging upload
- **THEN** the server verifies its enforced MD5 and length, conditionally copies it within COS to an immutable final key, and atomically publishes ownership and optional captured-version export metadata
#### Scenario: Retry completion or use expired credentials
- **WHEN** completion is retried or a temporary session expires
- **THEN** completion does not duplicate assets, and the browser renews its scoped session without falling back to server byte transfer
