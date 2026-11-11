# Proposal

## Why

The server exposes 27 runtime environment variables, mixing secrets, deployment choices, filesystem layout and implementation defaults. A pre-existing upstream setting silently made a local frontend use a remote backend; setup and diagnosis need one explicit configuration contract.

## What Changes

- **BREAKING** Reduce runtime environment inputs to one shared model key/base URL, two storage credentials and one optional data directory. Remove redundant defaults and derive platform-specific worker paths.
- Put necessary non-secret deployment settings in one optional, validated `demotif.config.json`, with built-in defaults and an example containing no credentials. Do not reproduce every old variable as a JSON field.
- Make local API ownership the default; require an explicit proxy mode and upstream URL in that configuration to forward requests.
- Provide a dry-run/apply configuration migration that reports names only, preserves secret values and original files, and never moves database/media files automatically.
- Remove all alternate remote audio adapters and their dependencies. All remote inference uses OpenRouter. Clean all Git refs of removed integration names, source protocols and documentation, keeping an external recovery backup.
- Inventory runtime, test-only and reference-tool variables separately; replace the reference-tool environment input with a CLI path argument.

## Capabilities

### New Capabilities

- `server-configuration`: Small server-only credential surface, explicit deployment mode, derived local paths and safe migration.

### Modified Capabilities

None; no main specifications currently exist. Coordinate configuration references in the in-flight shared-storage, contextual-audio and native-singing changes.

## Impact

Touches the server configuration and provider/adapter setup boundaries: `src/server/config.ts`, callers, `.env.example`, README, architecture/worker documentation and migration tooling. Preserves browser-owned audio, typed edits, expected-version checks, locks, append-only history, provider separation and one SQLite owner.

Non-goals: changing S3 durability to a disk adapter, removing working providers or proxy support, adding extra default Producer model presets, modifying application UI, moving user data or deploying services. Local API ownership does not imply local binary storage under the current S3 invariant.
