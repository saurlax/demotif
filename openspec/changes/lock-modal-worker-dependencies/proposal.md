## Why

Demotif maintains both GPU worker entry points in this repository. Use uv for both workers so Modal image builds consume reviewed dependency locks.

## What Changes

- Add a uv project and lock for YuE2 and build both GPU images from their respective locks.
- Document the common deployment and invocation workflow.

## Capabilities

### New Capabilities

- `locked-modal-worker-builds` covers reproducible dependency installation for both GPU workers.

## Impact

Worker build inputs and operator commands change. Existing private Modal method signatures, app names, project edits, and browser audio are preserved.
