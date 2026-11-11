# Design

## Context

See proposal.md for motivation. `NativeSinger` loads a pinned legacy DiffSinger implementation, while `score.py` derives Mandarin pronunciation with pypinyin. `profiles.ts` assumes that engine's configuration fields and checks file existence. Japanese scores are representable in the shared document, but no Japanese engine or frontend is implemented.

The existing job queue already snapshots accepted sources, writes derived audio assets, validates result alignment and scopes results to project ownership. `phraseSources` currently splits at every note gap, including small articulation gaps; resolving Japanese words separately after that split would lose reading context.

## Goals / Non-Goals

**Goals:** Add one validated Japanese singer through native NNSVS inference; retain current DiffSinger behavior and API/result compatibility; prove readiness with real CPU inference before advertising a repaired singer.

**Non-Goals:** New live transport, a Python API server, automatic synchronization/rebasing of drafts, implicit saves, changing existing lyric text to make a demo pass, or model training. No personal hosting configuration belongs in these artifacts.

## Decisions

### Use a second native engine behind the existing protocol

Add an engine discriminator to installed profiles, defaulting legacy profiles to DiffSinger. Define engine-specific profile schemas instead of requiring fake DiffSinger experiment/vocoder fields for NNSVS. Add an optional isolated NNSVS environment and executable setting in `src/server/config.ts` and `.env.example`; dispatch through `src/server/vocals/worker.ts` and `workers/singing/worker.py` while retaining protocol 1 and result alignment fields.

Use NNSVS `SPSVS` with a Japanese MusicXML/HTS-label frontend. The official inference API accepts full-context labels, supports CPU execution and separates timing/acoustic/waveform stages. Reusing the Chinese model with kana-to-pinyin approximations would change pronunciation; ONNX-only voices do not satisfy the selected native-runtime boundary.

### Make exact model selection an installation gate

Inspect one complete official Japanese NNSVS voice package, beginning with the Namine Ritsu CRISSCROSS distribution. Check its archive-local terms, native checkpoints, model classes, label/question resources, scalers and matching vocoder. The owner's general terms permit commercial use and redistribution but state that enclosed non-UTAU package terms take precedence; general terms alone do not approve the exact model.

Pin source revision, archive digest, runtime packages and all effective artifacts. First run a short original kana phrase in isolation. Reject incomplete packages and incompatible memory/runtime requirements before integrating them. Do not substitute the research-only Yoko package or the fine-tuning-oriented Canon base model as an already approved production singer. If no complete eligible package passes this gate, stop installation and identify the exact missing artifact or permission rather than showing a false-ready voice.

### Resolve Japanese readings before splitting inference work

Add `workers/singing/japanese_score.py` to resolve full-source lyric context with a Japanese reading frontend, preserving original note IDs and explicit reading/phoneme overrides. Normalize script only in derived pronunciation, not stored text. Map generated morae/phonemes back to each original note's duration budget; continuation extends the final syllable. Ambiguous text-to-note mappings require explicit readings and report the original note ID.

Emit MusicXML/HTS-compatible contexts with rests and derived sub-note timing. Predicted intra-note phone durations are constrained to accepted note boundaries before acoustic inference. Keep leading silence and release metadata consistent with current results. Apply pitch/volume/vibrato only through validated engine controls; reject unsupported requested controls rather than advertising or silently ignoring them.

Adjust `src/server/vocals/fingerprint.ts` and phrase preparation so short articulation gaps do not destroy Japanese lyric context. Fingerprints include engine identity, frontend version/resources, resolved pronunciation and model/vocoder digests. Preserve DiffSinger cache semantics through explicit compiler-version separation and test old ready assets.

### Integrate through existing edits and playback

Extend `profiles.ts`, editor capability types and `src/lib/vocal-lyrics.ts` for Japanese reading validation and engine-specific readiness. Distinguish missing voice, incompatible runtime and invalid score errors through the existing toast path. Keep ordinary instrumental editing available without either optional engine.

After a real Japanese phrase succeeds, bind a selected existing score through `source.update` at its current `expected_version`. Preserve original lyric assignments and notes. Only explicitly selected drafts are edited; rendering does not save, unmute, overwrite the base project or alter other drafts. Existing draft/base conflicts remain visible rather than bypassing their checks.

## Risks / Trade-offs

- [Model packaging or usage mismatch] -> Check the exact archive and bundled terms before loading; record digests and readiness failures.
- [CPU time and memory] -> Measure a short phrase's peak memory, wall time and audio validity; retain asynchronous progress/cancellation. No latency promise or silent low-quality mode.
- [Older dependency incompatibilities] -> Use a pinned, optional isolated environment and regression-test the existing DiffSinger environment.
- [Japanese words split into arbitrary stored chunks] -> Resolve complete context first and require explicit readings where mappings cannot be established without guessing.
- [Timing drift, tail overlap and stale cache] -> Test rests, continuation, source offsets, repeats, tempo changes, cancellation and an exported vocal-inclusive mix against one accepted snapshot.

## Migration Plan

Add backward-compatible engine metadata and optional runtime configuration. Validate the exact voice installation and short CPU render before catalog readiness, then update only selected scores using the normal command API. Keep the old worker, profiles and matching derivative assets intact. Rollback disables/removes the new profile or restores the previous application version without stripping Japanese score data or rewriting project history. Environment-specific rollout details remain private.

## Evidence

- NNSVS inference API: https://nnsvs.github.io/modules/svs.html
- Official NNSVS demos and research-only pretrained-model warning: https://nnsvs.github.io/notebooks/Demos.html
- Candidate voice owner's terms: https://www.canon-voice.com/terms/
- Fine-tuning base model documentation (not a selected ready singer): https://huggingface.co/Canon/nnsvs-wavehax-base

No Japanese voice package has yet passed installation or inference; these are implementation acceptance gates, not completed evidence.
