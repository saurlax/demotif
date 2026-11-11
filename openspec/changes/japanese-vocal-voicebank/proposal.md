# Proposal

## Why

Japanese vocal scores can be saved, but the only implemented singer adapter compiles Mandarin lyrics for a legacy DiffSinger model. A Japanese score that references an uninstalled placeholder voice therefore cannot be auditioned by installing that Chinese model or changing track mute state.

## What Changes

- Add an optional native Python/PyTorch NNSVS adapter and a Japanese score frontend alongside the existing DiffSinger adapter, behind the same inference-only JSON Lines worker boundary.
- Extend installed voice profiles with explicit engine and language metadata, compatible runtime checks, artifact fingerprints, and verified usage information. Preserve existing DiffSinger profiles.
- Convert accepted Japanese lyrics, pronunciation overrides, notes, rests and continuation into timing-aligned synthesis inputs. Keep stored lyric text and note geometry authoritative.
- Reuse existing versioned source edits, durable jobs, phrase assets, cancellation, playback and export; expose unsupported controls truthfully.
- Replace placeholder voice references only through explicit source-update commands after the installed Japanese voice passes an actual short render. Preserve independent drafts and explicit Save semantics.

This extends the one-language first milestone of the in-flight `score-driven-vocal-synthesis` change. It does not change browser ownership of transport or turn the worker into an HTTP service.

Non-goals: training or fine-tuning, voice cloning, switching to ONNX, substituting speech or instrumental tones for singing, migrating data, changing hosting/DNS, or silently synchronizing independent drafts.

## Capabilities

### New Capabilities

- `japanese-vocal-synthesis`: Japanese voice installation/readiness, score compilation and native singing through the existing vocal job contract.

### Modified Capabilities

None. There are no published main specs. This capability builds on the in-flight vocal score and phrase-rendering contracts rather than duplicating them.

## Impact

- Adapter: `workers/singing/worker.py`, new Japanese compiler/adapter modules and a separately pinned optional NNSVS environment.
- Server: `src/server/vocals/profiles.ts`, `fingerprint.ts`, worker dispatch and installed-voice tests; keep existing APIs and result alignment compatible.
- Editor: language-aware pronunciation validation and supported-control availability in the existing vocal editor.
- Dependencies: NNSVS, Japanese label/reading frontend and the selected model's native audio dependencies; acquire only after an exact compatible archive and its accompanying terms are checked.
- Verification: real CPU Japanese phrase synthesis, lyric/timing and cache regressions, independent-draft edits, single-clip audition and vocal-inclusive WAV export. Deployment details remain outside the repository.
