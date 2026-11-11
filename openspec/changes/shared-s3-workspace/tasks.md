# Tasks

## 1. Storage and API sharing
- [x] 1.1 Implement scoped S3 binary adapter, integrity verification and generic private configuration; test upload/read/range/abort/errors and real namespace access; document configuration.
- [x] 1.2 Add server-side upstream API streaming proxy before local runtime initialization; test methods, queries, body, SSE, range, abort and no local fallback; document single-owner SQLite architecture.

## 2. Media and native resources
- [x] 2.1 Separate asynchronous asset preparation from synchronous SQLite publication; integrate uploads, generated audio, vocals and private streaming; test failed publication, ownership, ranges, cancellation and cached render reuse.
- [x] 2.2 Publish built-in/example catalog binaries with SQLite metadata; test clean-cache preview and example draft creation; document catalog bootstrap.
- [x] 2.3 Store portable voice artifact catalogs and verified cache materialization; test corruption/cold-cache recovery and real native synthesis; document worker cache setup.
- [x] 2.4 Persist browser WAV exports in S3 with captured project/version metadata and local download; test upload failures and edits during export; document export retrieval.

## 3. Migration and history preservation
- [x] 3.1 Implement consistent inventory, resumable binary upload and collision-safe SQLite import preserving the relationship graph; test dry-run, divergent IDs, missing files and reruns; document recovery.
- [x] 3.2 Verify existing delta history and Save/undo invariants without per-edit snapshots; test replay, receipts, locks, drafts and preserved musical state; update architecture documentation.
- [x] 3.3 Back up and migrate both actual workspaces; verify counts, hashes, relationships, vocal cache bindings and musical content; retain private provenance/rollback reports.

## 4. Cutover and acceptance
- [x] 4.1 Activate verified SQLite/S3 backend and local upstream configuration using private operational files; verify one owner, persistent database and no fallback; preserve rollback sources.
- [ ] 4.2 Verify cross-frontend edits, conflicting saves, undo, Producer events, recordings, real native vocal audition and persisted vocal-inclusive export; retain private playable evidence.
- [x] 4.3 Run complete tests, typecheck, lint and production build plus real storage/outage/restart checks; report evidence and limitations before marking completion.

## Verification notes

Storage, real native PCM generation, source integrity, API sharing, Save conflicts, undo, resumable events, uploads, export persistence, HTTP ranges/HEAD/conditional requests, cancellation and outage checks passed. Original sources and verified backups are retained privately.

During the STS follow-up, real browser playback and a vocal-inclusive whole-song export both passed. Network evidence confirmed direct COS audio reads, direct staging PUT and metadata-only completion. Task 4.2 remains open only for the previously planned clip-editor audition/seek/loop acceptance; that additional editor interaction was not repeated in this change.

## 5. Direct STS browser transfers
- [x] 5.1 Implement exact-object STS issuance, durable upload reservations, checksum-verified conditional copy and idempotent publication; test scope, ownership, failed completion and immutable final keys.
- [x] 5.2 Move browser loading, previews, imports, recordings and exports to temporary-credential S3 access with expiry renewal; remove binary relay API paths; test direct transfer, errors and cancellation.
- [x] 5.3 Configure private CORS while retaining unrelated rules, deploy both runtimes, verify real STS upload/download and scope denial, run tests/typecheck/build/lint, and document evidence and remaining browser limitations.
