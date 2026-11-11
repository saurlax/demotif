## Why

The Demotif host should run Next.js without native audio or inference subprocesses.

## What Changes

- Deploy the verified Japanese voice as a private Modal CPU worker.
- Move offline audio analysis, media conversion and probing to a private Modal CPU worker.
- Route application inference through Modal while preserving browser audio, durable assets and versioned edits.

## Capabilities

### New Capabilities

- `modal-audio-workers` covers hosted Japanese singing and offline audio processing.

## Impact

The Node backend still owns SQLite, job coordination and media publication. Offline Python scripts remain available for operator validation.
