## Why

The user needs to sing a real reference take against the current vocal score so that phrasing and expression can be evaluated from a performance rather than guessed. Demotif currently imports audio but has no microphone capture or lyric-guided recording workflow.

## What Changes

- Add a Record reference action to vocal clip editors, opening a focused recording dialog with the selected source's lyrics, musical cue positions, current/next phrase, elapsed time, and progress.
- Provide microphone selection, a real input-level indicator, one-bar count-in, local capture, stop, take audition, re-record, WAV download, and explicit Save reference.
- Use the existing score as a cue sheet, including multiple syllables per note and continuations; label within-note syllable positions as estimated when no timing is authored.
- Persist accepted takes as reference audio assets and clips through existing uploads and versioned commands, retaining the original vocal score and synthesis.
- Store a typed, optional reference-recording snapshot on the accepted audio source, preserving source identity, lyric cue timing, tempo and recording offset for later analysis.
- Protect active recordings and unsaved takes during dismissal/navigation and retain a finished take after save failures.
- Boundaries: browser audio owns capture, cue timing, count-in and preview; the server model and media adapter own explicit persistence. No synthesis provider change.
- Non-goals: automatic performance-to-score alignment, expression extraction, voice cloning, pitch correction, background capture, accompaniment playback/monitoring, take comping, or a generic studio-wide recording system. First version records against silent visual cues and an optional headphone count-in, without requiring synthesized vocals.

## Capabilities

### New Capabilities

- `guided-vocal-recording`: Score-guided browser microphone recording, take review/retry/download, and explicit reference persistence.

### Modified Capabilities

None. The main specs directory is currently empty; the new capability composes existing upload, commands, locks, and draft save behavior without changing them.

## Impact

- `src/features/studio/part-editor.tsx` receives a vocal-only entry point; a new recording dialog and lyric-cue utility live beside existing vocal controls. Preserve ongoing editor playback changes in this worktree.
- New browser capture/session module under `src/audio/`, using Web Audio, AudioWorklet PCM capture and WAV encoding with no additional dependency.
- `src/features/studio/studio-page.tsx` coordinates persistence and navigation protection using the existing versioned mutation queue and save tracking; `src/lib/api.ts` reuses uploadAudio with reference kind.
- `src/shared/schema.ts` gains optional recording-reference metadata on audio sources; old documents remain valid.
- Existing Node media APIs, SQLite, draft semantics and asset ownership are reused; no database migration or Python change is expected.
