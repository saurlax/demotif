## Why

Demotif needs a hosted YuE2 worker to evaluate editable ABC planning and full-song rendering as separate operations.

## What Changes

- Deploy a private YuE2 GPU worker in Modal and verify connectivity without generating content.
- Expose separate authenticated Modal methods for planning and rendering for later testing.

## Capabilities

### New Capabilities

- `hosted-yue2-worker` provides on-demand YuE2 planning and rendering operations.

### Modified Capabilities

None.

## Impact

Provider boundary only. The initial deployment excludes Producer integration, browser audio changes, project edits, and live generation tests.
