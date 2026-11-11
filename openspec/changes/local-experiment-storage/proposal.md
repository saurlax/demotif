## Why
Local audio experiments currently use a remote object store and vendor-specific temporary credentials. They should run against persistent lightweight loopback S3 while retaining existing projects and production configuration.

## What Changes
- Add an opt-in S3rver development command with a persistent data directory and bucket.
- Support path-style loopback HTTP S3 and its public development-only credentials for direct browser transfers. Remote endpoints retain HTTPS and existing temporary authorization.
- Copy and verify accepted object references before switching ignored local configuration; retain originals and backups.

## Capabilities
### New Capabilities
- `local-object-storage`: local experiment object storage and verified cutover.
### Modified Capabilities

## Impact
Server storage and browser direct-transfer boundary only. Project documents, version checks, locks, undo and browser audio ownership remain unchanged. No model/provider credential changes or additional environment variables.
