# Tasks

## 1. Configuration contract

- [x] 1.1 Implement the strict optional deployment-file loader, five env inputs, constants, data-root paths and OS-derived worker executables; verify focused tests cover defaults, malformed JSON, unknown fields, redacted errors and Windows/POSIX paths.
- [x] 1.2 Implement explicit local/proxy mode and actual mode in health output; verify existing proxy tests still prevent SQLite initialization/fallback and local tests use local ownership.
- [x] 1.3 Use one OpenRouter key/base URL for all remote models and remove alternate audio protocols, dependencies and capability entries; verify mocked request URLs/credentials, unsupported modes, and provider/audio/vocal tests.
- [x] 1.4 Update .env.example, deployment config example, .gitignore and startup/storage docs; verify samples validate and only five runtime env names remain documented for setup.

## 2. Migration and ancillary tools

- [x] 2.1 Add dry-run/apply config migration with backups, atomic writes, quoted-value preservation, no value logging and explicit conflict detection; verify tests for existing upstream, custom data layouts, removed overrides, retries, failure before replacement and preserved secrets.
- [x] 2.2 Replace blind legacy env copying in migrate-local-data.mjs with explicit config-migration guidance; verify source data/env and destination credentials remain unchanged in a temporary migration fixture.
- [x] 2.3 Replace DEMOTIF_DIFFSINGER_REFERENCE with an explicit root argument, update launcher docs, and retain opt-in test switches outside runtime config; verify argument forwarding without downloading models and audit all 30 historical names against the inventory.
- [x] 2.4 Update affected in-flight configuration references and README migration/rollback instructions; verify no removed variable is still presented as supported configuration outside migration documentation.

## 3. Integration and local configuration

- [x] 3.1 Run npm test, npm run typecheck and npm run build; verify changed configuration does not alter command/version/lock behavior or expose secrets in client output.
- [x] 3.2 Dry-run then apply this workspace's config conversion with backup, preserving OpenRouter credentials and deliberately selecting local API ownership; verify original files remain recoverable, no SQLite/media paths move, and health is served by the local process.
- [x] 3.3 Smoke-test local project list/open/edit/save and provider readiness using real local data without mutating saved projects; record storage-unavailable limitations explicitly if S3 is unconfigured and do not substitute a mock backend for successful local startup.

## 4. Repository history

- [x] 4.1 Back up repository refs and dirty worktree externally and audit all refs/blobs/messages/paths for removed integration content; verify recovery artifacts exist without printing credentials.
- [x] 4.2 Rewrite an external mirror, preserve current edits while replacing local refs/index, clear obsolete reflogs/objects and update affected remote branches with leases; verify all retained refs and fresh remote history contain no removed content.
