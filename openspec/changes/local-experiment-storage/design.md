## Context
Windows local development has no container runtime. S3rver can provide the required PUT, GET, HEAD, copy, metadata and CORS operations from Node with persistent files.

## Goals / Non-Goals
Local-only experiment storage, integrity-preserving migration and unchanged remote behavior. No production S3 emulator deployment or new storage abstraction.

## Decisions
Use a development dependency and explicit `npm run dev:s3`, bound to 127.0.0.1:4569. Store objects below data/s3, bucket demotif-local. Reuse existing endpoint/bucket JSON settings and the two S3 credential environment variables. Loopback storage uses path-style addressing and S3rver's documented public test credentials; reject other keys in the local browser-session branch so production secrets cannot be exposed. Remote endpoints continue requiring HTTPS and scoped temporary credentials. The direct-transfer response can omit the session token for the local emulator.

## Migration Plan
Back up ignored local settings and SQLite. Copy only accepted asset and catalog object references using the original configuration, verify content digest and byte length, and keep object keys stable. Switch local settings only after verification, restart the app and verify real browser playback/upload/export. Never delete remote originals. Rollback restores the ignored settings backup.

## Risks / Trade-offs
S3rver is a development emulator with a smaller API surface; exercise the exact application calls. Its public test key is restricted to loopback endpoints and the emulator binds only loopback. Existing local browser transfer tickets require a fresh page after cutover.
