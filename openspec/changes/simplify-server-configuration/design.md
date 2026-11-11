# Design

## Context

The server originally consumed 27 environment variables. The user approved simplifying configuration and requires every remote model to use OpenRouter, with a shared key and base URL. Optional native singing and analysis remain subprocesses. Removed remote adapters, their tests, protocols, ability identifiers and internal documentation must not remain in the repository or reachable Git history.

## Goals / Non-Goals

Five runtime env inputs: DEMOTIF_LLM_API_KEY, DEMOTIF_LLM_BASE_URL, DEMOTIF_S3_ACCESS_KEY_ID, DEMOTIF_S3_SECRET_ACCESS_KEY and optional DEMOTIF_DATA_DIR. Preserve typed commands, draft/version/lock validation, browser audio and S3 durability. User-approved default DeepSeek Flash model, remote deployment or storage adapter redesign.

## Decisions

Use src/server/settings.ts as the strict loader for optional ignored demotif.config.json and the five env inputs. The example has local mode and the default DeepSeek Flash model; defaults work without a file. File fields are explicit local/proxy mode, storage endpoint/bucket/region/prefix, producer model/settings and singing device. Unknown fields and obsolete env names report names only. Fixed upload limits and OS-derived Python paths need no config. All data paths derive from DATA_DIR.

All remote catalog, chat, music and speech requests read the same llmKey and llmURL. Base URL defaults to https://openrouter.ai/api/v1. Producer uses chat completions; audio retains OpenRouter-specific music/speech framing. No alternate protocol or credentials are retained. Unsupported remote modes reject before network calls; completed media remains available. No remote job can be resumed automatically.

Configuration migration defaults to dry run; explicit apply preserves original files, validates before writes, uses temporary files and backup/rollback, and preserves unrelated env values. Merge identical legacy model keys; refuse differing keys or non-OpenRouter URLs. Never silently relocate SQLite/media or change a custom layout. --local deliberately removes the old proxy selection for this workspace. The data-copy script must no longer copy legacy env.

Reference CLI accepts an explicit root argument; its historical env input is removed. Two opt-in test env switches remain outside runtime configuration.

History cleanup operates on an external mirror, with a bundle and worktree backup outside the repository. Scan blobs, messages, paths and all refs, including local tooling snapshots. Remove historical dedicated adapter files and sanitize documentation. Preserve current uncommitted files while updating local refs/index, expire obsolete reflogs and prune obsolete objects. Update remote branches/tags with explicit leases against verified old refs, without pushing private local tooling refs. Verify fresh remote history and current working tree. External backups are recovery artifacts, never committed or pushed.

Affected files: config/settings and focused tests; producer; audio-jobs/provider/API/shared contracts and tests; migration scripts; environment/config examples; worker launcher; README/architecture and affected in-flight specs; dependency manifest/lock. No new dependency.

## Risks / Trade-offs

- Shared key migration can encounter distinct old credentials → refuse ambiguous merging.
- Old custom data layouts → fail with names only; no data moves.
- S3 remains required for durable binaries → do not report fully offline success.
- History rewrite changes commit IDs → back up externally and use per-ref leases; hosted unreachable-object caches may require separate host administration.
- Dirty working tree → snapshot externally, rewrite a mirror, compare retained files before/after local ref changes.

## Migration Plan

Verify loader/migration/provider behavior, update documents and remove unused dependencies. Dry-run/apply local conversion while preserving the existing key, select local ownership and verify local health/project operations. Rewrite history only after current source is clean of removed integration details. Restore original configuration for rollback if needed; application data is never moved. Run tests, typecheck, build and all-ref/remote scans.
