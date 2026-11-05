## 1. Reference contracts and lyric cues

- [x] 1.1 Add optional typed audio-source reference-recording metadata and the optional upload reference kind without changing existing callers; verify schema tests for legacy documents, valid snapshots and rejected invalid timing, plus save/load round-trip tests.
- [x] 1.2 Implement score-to-cue snapshots for source ranges, rests, grouped syllables, continuations, timing provenance and source-placement offsets; verify tests for authored/estimated timings, compound meter, fractional imports and ambiguous overlaps without mutating input.

## 2. Browser capture and take lifecycle

- [x] 2.1 Implement AudioWorklet mono PCM capture, frame-gated start/stop and WAV encoding with generation-safe permission setup and real input levels; verify deterministic PCM/frame-boundary/WAV tests and microphone cleanup after late grants, cancellation and setup failures.
- [x] 2.2 Implement one-bar visual count-in, optional separate audible count-in, auto-stop/release tail and review/re-record ownership with the previous take retained; verify fake-clock tests for 4/4 and 6/8, failed replacement, zero-frame capture, device loss and hidden-document interruption.
- [x] 2.3 Implement take audition, seek and clock-derived cue progress without microphone monitoring; verify synthetic-input browser capture excludes generated clicks and that review seek updates displayed cues while releasing nodes and object URLs on disposal.

## 3. Studio recording workflow

- [x] 3.1 Add the vocal-only Record reference action and shared dialog with microphone selection, actual level, timed lyric ruler, current/next text, progress, record/stop, audition, re-record and WAV download; verify desktop/narrow layout, long/grouped lyrics, reduced motion and keyboard/focus behavior without altering existing editor playback work.
- [x] 3.2 Coordinate recording ownership, external snapshot changes and shared unsaved/departure protection through StudioPage; verify cancellation retains the take, confirmation discards and cleans up once, refresh has native protection, and conflicting playback/shortcuts cannot start during capture.
- [x] 3.3 Persist Save reference through reference upload and one expected-version batch adding source/library entry/muted reference placement plus immutable cue metadata; verify command lock/version checks, negative-origin placement offsets, repeated save handling and failed-upload/failed-command retry without losing the take or original synthesis.

## 4. Integrated verification and documentation

- [x] 4.1 Run targeted capture/cue/schema/service tests, npm test, npm run typecheck, npm run lint and npm run build; resolve failures attributable to this change and record results.
- [x] 4.2 Exercise permission denial, count-in, early stop, auto-stop, download, seek, failed re-record, save/reload, departure cancel/discard and microphone release at desktop and narrow widths; use synthetic input where available and explicitly report any physical-microphone checks that remain unverified.
- [x] 4.3 Document how to open a vocal source, record/re-record, download/share a take and save the reference/project, with the silent-cue scope and future offline alignment boundary; verify instructions against the implemented UI and validate the OpenSpec change.
