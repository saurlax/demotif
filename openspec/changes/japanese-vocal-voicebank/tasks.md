# Tasks

## 1. Validate one Japanese singer

- [x] 1.1 Inspect the exact official Namine Ritsu CRISSCROSS NNSVS package and accompanying terms; record archive/revision digests, native model classes, frontend resources, scalers and matching vocoder in a model-screening record. Verify a complete inference package and intended-use compatibility before loading; report specific blockers if this candidate fails.
- [x] 1.2 Pin an optional isolated NNSVS CPU environment and Japanese frontend dependencies. Run a short original kana score using the selected native model, retain playable WAV and finite/non-silent PCM checks, record peak memory and wall time, and document reproducible installation and attribution. Do not advertise readiness until this passes.

## 2. Extend installed profiles and engine dispatch

- [x] 2.1 Add backward-compatible engine-specific profile schemas, optional runtime configuration and truthful readiness checks. Test old DiffSinger profiles, valid Japanese profiles, missing runtime/artifacts and incompatible languages; update `.env.example` and worker setup documentation.
- [x] 2.2 Dispatch the existing protocol-1 worker to the selected native engine with an isolated warm process. Test startup, readiness, render result/alignment validation, worker failure, cancellation and existing DiffSinger regression behavior; document protocol compatibility.

## 3. Compile accepted Japanese vocal scores

- [x] 3.1 Resolve Japanese full-source lyric context, kana/kanji readings and explicit overrides before phrase splitting. Add fixtures for words crossing notes and short articulation gaps, invalid readings and original-note error locations; verify stored lyrics and note geometry remain unchanged.
- [x] 3.2 Generate MusicXML/HTS inputs with derived within-note mora/phone timing, rests and continuation. Test timing budgets, leading/trailing silence, sustained syllables and unsupported expression rejection; render one real multi-note phrase and verify scored duration/alignment and pronunciation.
- [x] 3.3 Extend engine/frontend/model fingerprints and Japanese phrase preparation. Test cache invalidation after reading/model/tempo edits, reuse after placement-only edits, stale completion and cancellation; retain legacy saved-audio access and document cache-version behavior.

## 4. Integrate voice selection and audition

- [x] 4.1 Expose the validated Japanese voice and supported controls in the existing vocal workflow, including Japanese pronunciation validation and actionable missing/incompatible installation errors. Test language selection and error notifications while ordinary editing still works without optional engines.
- [x] 4.2 Bind the installed voice to an explicitly selected Japanese score using versioned `source.update` commands. Verify unchanged lyrics/notes/unrelated tracks, locks, undo, independent-draft isolation, explicit Save and existing version-conflict behavior; keep personal project repair details outside repository artifacts.

## 5. Verify the complete workflow

- [ ] 5.1 Verify real single-clip Japanese audition, seek/loop alignment and a vocal-inclusive WAV export from one accepted project snapshot; retain playable artifacts and inspect for missing phrases, clipping, timing drift and stale audio. Keep mocked coverage distinct from actual CPU inference evidence.
- [x] 5.2 Run focused Python/compiler and installed-model checks plus `npm test`, `npm run typecheck`, `npm run build` and `npm run lint`; record outcomes and document remaining limitations without marking unverified inference as complete.
