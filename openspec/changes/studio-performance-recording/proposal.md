# Proposal

## Why

The introduction film's central demonstration asks Producer for four preparatory clicks, then starts accompaniment and a real vocal take together. The app has isolated reference capture with optional count-in, but no workbench metronome, accompaniment-synchronized recording or Producer control over browser performance.

## What Changes

Extend chat-driven recording with a required segment description, explicit destination, start/end beats, count-in, accompaniment choice and requested follow-up. Capture ends locally at the selected frame without another click. Return server-verified placement to Producer so the conversation can continue with existing audio-to-notes/editing tools. Expose acknowledged Save/Save as and WAV export through browser tools; actual brush media remains a separate material dependency.

Software implementation covers metronome, synchronized direct-to-track recording and acknowledged Producer controls. Every completed recording, including re-recordings, uses ordinary audio tracks and Clips. Dedicated A/B, take lists and selection interfaces are excluded. Real microphone/headphone rehearsal remains pending.

- Add a studio metronome with an accessible transport toggle, meter accents and local count-in configuration.
- Share a browser audio clock between preparatory clicks, accepted-project accompaniment and microphone capture, with a four-pulse option for the film and a one-bar option respecting meter.
- Add general recording from the transport with only necessary microphone/count-in configuration. Automatically place each completed recording as an ordinary audio Clip on its own audio track. Re-recording adds another Clip without replacing previous recordings; reuse existing track playback, mute/solo and Clip editing.
- Add validated Producer browser-control requests for metronome, playback, recording preparation and stop, with actual browser acknowledgements and idempotent ownership.
- Hold realtime conversation capture and speech during counted recording so singing is recorded as music rather than interpreted as a new chat turn; restore conversation afterward.

## Capabilities

### New Capabilities

- `studio-performance-recording`: Browser-clock metronome, count-in, accompaniment and microphone recording directly into reusable audio Clips.
- `producer-performance-control`: Acknowledged, project-scoped Producer control of the browser performance session.

### Modified Capabilities

None in the empty main-spec inventory. Existing reference recording and realtime voice change artifacts remain relevant compatibility inputs; update their implementation descriptions when this change lands.

## Impact

Touches browser audio, browser session state, the Producer provider/tool boundary and the server request adapter. Musical content still enters the draft only through validated ProducerCommand batches with expected_version, lock checks and append-only undo; explicit Save remains required. Scheduling and microphone start remain browser-owned and do not depend on per-beat network messages.

Non-goals: dedicated A/B or take-management interfaces, humming-to-notes ingestion, brush sample acquisition, vocal pitch correction, live input monitoring, punch-in/automatic comping, music generation quality changes, new provider defaults or voices, and film asset generation. Remaining script gaps are inventoried in design.md.
