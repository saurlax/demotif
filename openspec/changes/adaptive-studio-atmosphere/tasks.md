Deferred: planning is complete; implementation has not started and requires a separate request.

## 1. Contracts and appearance preferences

- [ ] 1.1 Add typed profile, evidence, confidence, version/digest and Auto/manual/Off preference contracts; verify serialization and invalid-value tests, including no musical-document mutation or revision.
- [ ] 1.2 Add neutral/manual preference resolution and confidence gating; verify explicit overrides, missing analysis, low confidence, stale results and project switching with deterministic tests.

## 2. Read-only analysis and clock observations

- [ ] 2.1 Add bounded browser audio-feature extraction and read-only master-output/clock observation alongside `audio.ts` and `use-audio-session.ts`; verify silence, mute/solo, scheduled start, seek and clip-loop fixtures against actual output and playback time.
- [ ] 2.2 Add the optional server atmosphere-analysis adapter using the configured model route and aggregate features only; verify strict inputs, structured results, no raw-media upload, no edit tools, server-only credentials and bounded failure behavior with mocked-provider tests.
- [ ] 2.3 Add single-flight analysis and version/digest cache handling; verify repeated clicks do not duplicate provider calls, stale responses are ignored and failures are not automatically retried.

## 3. Background rendering

- [ ] 3.1 Add a studio-only pointer-transparent atmosphere layer with static Neutral/Classical/Electronic profiles; verify screenshots on desktop/narrow screens and confirm home/global library use the normal shared theme.
- [ ] 3.2 Add optional bounded shader rendering and real playback-driven uniforms; verify Classical/Electronic visual distinction, phase alignment after seek/loop, quiet response to silence and unchanged clip/note gesture geometry.
- [ ] 3.3 Add graphics-context fallback and lifecycle cleanup; verify no visual frame work on pause/hidden document/Off, resource release on departure and usable editing after context loss.

## 4. Controls and accessibility

- [ ] 4.1 Add compact profile, Analyze, Off and motion-intensity controls using shared shadcn components; verify keyboard operation, truthful analysis provenance/uncertainty, manual fallback without credentials, and per-project preference retention.
- [ ] 4.2 Apply reduced-motion/static behavior, focus and contrast safeguards; verify OS reduced-motion emulation, foreground legibility, minimum font sizes, and no strobing or movement of editing controls.

## 5. Integration verification

- [ ] 5.1 Compare live playback and exported audio with atmospheres enabled/disabled and with analysis/rendering failure; verify output equivalence and unchanged command versions, locks and undo using audio/protocol regression tests.
- [ ] 5.2 Profile a representative multitrack project during dragging and playback on desktop/mobile-sized views; verify the 30/15fps and 1.5 DPR budgets, static fallback under load, and zero audio-start dependency on analysis. Run frontend build/tests and relevant backend tests with mocked credentials.
