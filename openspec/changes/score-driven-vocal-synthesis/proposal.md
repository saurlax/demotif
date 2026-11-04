## Why

Demotif can arrange instrumental notes and imported vocals, but cannot turn an editable melody and lyrics into a singing performance. Add score-driven singing synthesis with quality-first server inference while keeping responsive editing and real-time playback in the browser.

## What Changes

- Allow phrase entry inside the selected note by default, with an explicit equal-note Split action and no placement-mode selector. Preserve text, unrelated notes and reversible commands; never silently discard excess syllables.
- Add a monophonic vocal source with note-aligned lyrics, syllable continuation, pronunciation overrides, editable pitch and basic expression. Reuse the existing clip library, piano roll, mixer and save/undo workflow.
- Add asynchronous phrase rendering through an adapter around DiffSinger's native PyTorch inference path. Next.js remains the only application/API server; a separately managed server-side model process computes durations, pitch, acoustic features and waveform audio.
- Persist render jobs and content-addressed phrase results in SQLite/local storage. Reuse unchanged results, cancel obsolete work and prevent late output from replacing the current score.
- Keep one voice and one validated language in the first release. Select them by available native checkpoints/configuration, listening quality and applicable terms, not by a fixed language preference. Candidate evaluation precedes editor expansion; no production voice is approved by this proposal.
- Provide visible missing/rendering/stale/error states and require current vocal audio for complete exports. Preserve source edits separately from derived audio.
- Explicit boundary change: supersede the blanket browser-only synthesis statement in current project guidance for non-real-time vocal inference. Browser transport, monitoring and existing instrumental DSP remain browser-owned. Non-real-time rendering may use server CPU/GPU resources without lowering output quality for browser execution.

Non-goals: training a foundation model or custom singer, voice cloning, prompt-generated songs, a formant voice substituted for neural singing, full multilingual support, cloud deployment/authentication, Redis or a distributed scheduler, genre shaders, and moving the entire live DAW to the server. A reference-quality short phrase and a working single-voice workflow are the first milestones, not parity with commercial editors.

## Capabilities

### New Capabilities

- `vocal-score-editing`: vocal source creation and monophonic score/lyrics/pronunciation/expression editing through validated reversible commands.
- `vocal-phrase-rendering`: installed voice profiles, server inference, durable phrase jobs/cache, current-result playback and complete export.

### Modified Capabilities

None. The existing `openspec/specs/` directory contains no published requirements. This change adds capabilities and records the project-guidance boundary correction in its design and implementation tasks.

## Impact

- Browser: `src/features/studio/part-editor.tsx`, clip creation/library/previews, `src/audio/adapter.ts`, loading/playback/export and Producer actions.
- Server model: `src/shared/schema.ts`, `src/server/projects.ts`, `src/server/db.ts`, typed UI/API contracts and history/save tests.
- API/adapters: new `src/server/vocals/` modules and same-origin `/api/vocal-*` routes through the existing Node route handler; new `workers/singing/` inference-only package, with models under ignored `data/models/`.
- Dependencies: worker Python 3.11 and PyTorch/NumPy plus only the selected model's required metadata/audio packages; Node/UI dependencies added only if implementation demonstrates a need. The first release requires native acoustic/variance and vocoder checkpoints with matching configs; ONNX-only distributions are not eligible. CPU is the development baseline; CUDA is an optional inference deployment, not a prerequisite for ordinary project use.
- Existing examples, instrumental/audio sources, custom track colors, locks, version checks, explicit save semantics and append-only history remain compatible. Existing local media is not rewritten or removed.
