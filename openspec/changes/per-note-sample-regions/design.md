## Context
Existing samplers play the same source origin for every note. Full reconstruction needs many windows of one accepted owned audio asset without exporting hundreds of WAV files.
## Goals / Non-Goals
Add note.sample {offset,duration,rootNote}, all source-window lengths in seconds and pitch in MIDI semitones. Existing note timing remains beats; adapter converts only timing. Region notes require a note or drum source with a sampler and owned asset. No automatic transcription service, independent pitch/time/formant algorithm or stem-separation UI is added.
## Decisions
Browser PCM rendering reads only the clamped region. The note root overrides the instrument root. Per-note windows do not implicitly loop outside their region; short windows stop rather than read adjacent syllables. Legacy samplers keep their loop/one-shot behavior. Existing ADSR applies at boundaries. Note dialog exposes region start, length and root for mapped notes. Moving notes changes destination time, not original source offsets; cloning preserves mapping. Invalid metadata rejects atomically.
## Risks / Trade-offs
Pitch changes still alter sample speed. Source separation and pitch candidates are estimates, so original stems remain muted references. Reconstructed melodic/harmonic score tracks must be labelled distinctly from sample-preserving slices.

Exports prepare/render only assets used by audible tracks, matching playback. Muted reference layers and inactive score alternatives do not allocate full-song render buffers or block export on unused media.

Long-song Fit may go below the manual zoom-out floor; overview ruler labels use a coarser power-of-two stride to remain readable. No musical timing or stored project state changes during fitting.

## Verification
212 tests passed, 3 skipped. Typecheck and production build passed; lint reported warnings only. Desktop and narrow layouts, mapped note parameter persistence, drum grid entry, playback and browser WAV export were checked. The local-only V2 experiment contains 18 tracks, 8 audible mapped layers with 8,708 regions, six muted source comparisons and four muted score candidates (1,363 notes). Final export is 199.189 seconds at stereo 44.1 kHz with no clipped samples. Separation and score candidates remain estimates; no Producer execution was used.
