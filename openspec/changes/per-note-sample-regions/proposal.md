## Why
OTOMAD reconstruction requires each note to trigger its own syllable or instrument slice. A single root sample loses the original pronunciation and articulation.
## What Changes
Add optional per-note source-window seconds and root pitch, browser DSP playback and note parameter editing. Use it in a separate second reconstruction project with local analysis; no Producer or paid generation.
## Capabilities
### New Capabilities
- `sample-region-notes`: editable per-note sample windows.
### Modified Capabilities
## Impact
Shared note schema, browser sampler and note modal. Preserve typed commands, version/lock checks, undo, legacy sampler behavior and browser-only rendering. No new runtime dependency or model integration.
