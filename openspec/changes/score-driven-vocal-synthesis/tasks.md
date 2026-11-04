## 1. Voice and reference-render milestone

- [x] 1.1 Screen candidate releases for legitimately available native PyTorch acoustic/variance and vocoder checkpoints, matching configs/dictionaries, and voice/vocoder terms; treat previously listed voice names only as unqualified research leads and exclude ONNX-only distributions; document local inference, output publication, redistribution and hosted-use status separately. Verify a source/version/digest/terms matrix exists and no weights, portraits or unapproved hosted voice are added to Git.
- [x] 1.2 Select one actually obtainable compatible voice and one supported language without assuming a preferred language. Inspect its native checkpoints, upstream code/config revision, phoneme inventory and matching native vocoder checkpoint/config, and deliver a profile manifest plus reference-render instructions. Verify actual checkpoint loading, configs and declared tensor/sample-rate/hop contracts match; if no eligible candidate exists, record the concrete missing artifact/permission before proceeding with editor expansion.
- [x] 1.3 Create isolated `workers/singing/` Python 3.11 environment and PyTorch and the minimal upstream native inference dependencies for that profile, pin tested versions, and document applicable upstream notices. Verify CPU checkpoint/model loading on the available host and keep the web app and optional analysis environment usable independently.
- [x] 1.4 Reproduce upstream native PyTorch inference CLI outputs, then wrap the same pronunciation, duration/pitch/variance, acoustic and native vocoder inference classes in a score-to-phrase spike without ONNX conversion. Verify original 2-, 5- and 10-second test phrases against the reference renderer, delivering audible WAVs plus alignment/finite-PCM/tail checks; listen before expanding UI.
- [x] 1.5 Benchmark cold load, warm RTF and peak memory with device/runtime/model/preset recorded, plus a 30-second assembled example. Verify a report distinguishes measured results from targets, identifies final-quality settings and records whether the first candidate meets reference quality; report GPU results only when measured on available GPU hardware.

## 2. Editable vocal model and commands

- [x] 2.1 Extend shared schemas/types with vocal sources, stable note-syllable/continuation mapping, pronunciation overrides and defined pitch/vibrato/volume units. Verify old project/example fixtures parse unchanged and valid vocal fixtures round-trip.
- [x] 2.2 Extend source command validation and server editing with atomic note/lyric/curve changes, monophony and continuation/timing checks. Verify conflicts, invalid overlap, locked shared sources, missing pronunciation assignments and valid instrumental polyphony with focused service tests.
- [x] 2.3 Verify persistence and undo through regular drafts, examples, Save and Save as, including unavailable voice profiles. Deliver save/reopen/undo tests showing score content remains intact and native departure protection still reflects only actual edits/pending saves.

## 3. Phrase compiler and warm worker

- [x] 3.1 Extract the spike into versioned phrase/profile modules with source-local beat conversion, context rules, explicit consonant lead-in/tail and manual-versus-predicted pitch. Verify rests, continuations, fractional tempo, pronunciation overrides, frame rounding and no interpolation across silence against fixtures.
- [x] 3.2 Add the JSON Lines worker protocol and lazy warm-process adapter under `src/server/vocals/`, using files for PCM and one active inference initially. Verify readiness, warm model reuse, structured failure, malformed result, queued cancellation, active cancellation/termination and restart with an isolated test worker.
- [x] 3.3 Implement phrase fingerprints including checkpoint/config/upstream revision, model/compiler/phonemizer/context/seed/quality, PyTorch version, device backend, precision and sampling settings. Verify musical edits invalidate affected dependencies, arrangement movement/mix changes reuse results, and full-quality and preview results cannot be confused.

## 4. Durable jobs, media and same-origin API

- [x] 4.1 Add additive SQLite vocal-job/render tables, a dispatcher and atomic result publication using existing media ownership/storage conventions. Verify deduplication, partial-output rejection, interrupted recovery, dispatch after enqueue/startup and fingerprint compare-and-publish under late completion races.
- [x] 4.2 Implement installed-voice listing, render start/status/cancel/current-source resolution endpoints through the existing Next.js API. Verify accepted-version checks, unavailable engine/profile errors, project ownership, truthful stage progress and idempotent reuse without host allowlists or arbitrary phrase limits.
- [x] 4.3 Extend project/draft cloning and Save/Save as to preserve valid derived asset bindings and source provenance with remapped ownership. Verify reopened saved projects do not require the old draft and missing derivatives can be regenerated without changing score versions.

## 5. Vocal editing workflow

- [x] 5.1 Add Vocal to the library-plus creation dialog with installed voice/language selection and unavailable-installation state. Verify successful creation and keyboard operation at desktop and narrow widths; ordinary clip types remain functional when singing is not installed.
- [x] 5.2 Reuse the existing piano-roll geometry for lyric display, note-anchored lyric/pronunciation editing and a phrase lyric-assignment dialog. Verify note move/resize, continuation editing, focus return/Escape, input text selection, unchanged clip drag behavior and versioned persistence.
- [x] 5.3 Add collapsible pitch/volume lanes, vibrato controls and supported voice parameters; preserve the existing flat console theme and panel animations. Verify audible parameter effects with the real profile, commit-on-release, manual pitch persistence and truthful unavailable controls, including reduced motion/narrow layouts.
- [x] 5.4 Add explicit Synthesize/Retry/Cancel and ready/missing/stale/error states using active-job polling. Verify rapid committed edits, undo, project departure, editor closure and cancellation cannot bind obsolete audio or spawn a request per pointer move; show stages rather than fabricated percentages.

## 6. Playback, looping, export and Producer

- [x] 6.1 Resolve current phrase assets into prepared browser audio without replacing editable vocal sources. Verify aligned seek, trim, repeated placements, loop boundaries, model tails and sample-rate conversion with instrumental playback continuing during inference.
- [x] 6.2 Add explicit handling for unavailable/stale audible vocals and adopt newly completed buffers only at a preparation boundary. Verify stale output is never presented as current and instrumental-only audition requires a deliberate choice when vocal audio is missing.
- [x] 6.3 Make export resolve final-quality vocal results for one accepted score snapshot before the existing mix/export path runs. Verify cancelled/failed/missing renders prevent misleading downloads, muted/excluded vocals do not unnecessarily block, and edits during export cannot mix score versions; listen to exported vocal+instrument WAV against playback.
- [x] 6.4 Expose supported vocal edits and render/status actions to the Producer through the existing proposal/command workflow. Verify no direct model-driven score mutation, existing approval/locks/version behavior and actionable missing-worker errors with tool tests.

## 7. Integration and delivery

- [x] 7.1 Update AGENTS.md, OpenSpec context, architecture, research notes and `.env.example` for the server inference exception, optional worker installation, voice attribution and rollback. Verify root-level Next.js commands still work without Python/voices installed and there is no restored general `backend/` app.
- [ ] 7.2 Run `npm test`, `npm run typecheck`, `npm run build`, `npm run lint` and focused worker tests; run the opt-in installed-model test and produce a short original vocal-demo export. Verify reference-quality evidence, draft/save/undo/cross-tab/stale-job scenarios and desktop/narrow keyboard screenshots, clearly separating mocked coverage from real inference results.

## 8. Phrase entry and multiple syllables per note

- [x] 8.1 Add backward-compatible multiple-syllable mode and atomic forward/split lyric assignment helpers; test preserved suffixes, pronunciation, stable IDs, locks, undo and save.
- [x] 8.2 Expand native compilation for multiple syllables within one note with per-syllable budgets and last-syllable continuation; verify pronunciation, unchanged pitch, timing and a real installed-model render.
- [x] 8.3 Add note-local phrase editing and explicit splitting (subsequently simplified to implicit within-note entry); verify keyboard, desktop/narrow layout, top error notifications and no unintended edits.
- [x] 8.4 Update usage guidance and run tests, typecheck, build, lint and worker tests; retain original drafts and separate mock coverage from real native evidence.

## 9. Direct phrase entry and consistent note gestures

- [x] 9.1 Make within-note phrases the default without placement controls or following-note overflow; retain explicit Split, pronunciation, continuation and native compiler compatibility.
- [x] 9.2 Align duration editing to the editor grid with concise precision and unify piano/drum right-click deletion, preserving lock and vocal-reference validation.
- [x] 9.3 Verify focused regressions, worker tests, frontend build and desktop/narrow interaction checks; update usage and interface rules.
