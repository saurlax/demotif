> Implementation update (2026-11-04): the selected path is native PyTorch in an optional server-side worker, not browser/ONNX singing inference. The user approved non-commercial Demo models and the OpenCpop listening sample. See vocal-model-screening.md, vocal-native-benchmark.md and workers/singing/README.md for measured current evidence. Earlier alternatives below are research history, not the current runtime contract.

# Singing synthesis preparation

Status: research and scope selection, 2026-11-04. No singing engine, model runtime, or new dependency has been implemented. The first language and required voice quality remain open.

## Product reference

VOCALOID and ACE Studio provide useful interaction references: notes and lyrics describe a vocal performance, with pronunciation and pitch controls layered on the score. This is a score-driven singing feature, distinct from text-to-speech, vocal separation, voice conversion, and prompt-based full-song generation.

Primary sources consulted:

- [VOCALOID learning materials](https://www.vocaloid.com/en/learn/): entering notes and lyrics.
- [ACE Studio: creating AI vocals](https://docs.acestudio.ai/ai-vocal-synth/creating-ai-vocals): voice selection, MIDI notes and lyrics within vocal clips.
- [ACE Studio: editing notes](https://docs.acestudio.ai/ai-vocal-synth/creating-ai-vocals/editing-notes): monophonic vocal clips.
- [ACE Studio: editing pitch](https://docs.acestudio.ai/ai-vocal-synth/creating-ai-vocals/editing-pitch): generated pitch and user pitch overrides.
- [OpenVPI DiffSinger](https://github.com/openvpi/DiffSinger): candidate open singing-synthesis architecture; not integrated or benchmarked here.
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/): candidate browser inference runtime; runtime availability alone does not establish compatibility or performance for a particular singing model.

## Existing integration points

- `src/shared/schema.ts`: `track.kind` already includes `vocal`, but sources are only `notes`, `drums`, or `audio`. Notes contain pitch, start, duration and velocity; there is no lyric, phoneme, or vocal expression representation. All new optional fields must preserve old document parsing.
- `src/server/projects.ts`, `src/shared/schema.ts`: vocal editing must use versioned commands and preserve locks, draft/save semantics and append-only undo. Existing source-update validation needs review when adding vocal fields; adding a UI-only property will not persist it.
- `src/audio/adapter.ts`: maps stored musical beats to render-time seconds. Vocal timing must use this same conversion, including meter-independent tempo handling.
- `src/audio/audioTasks.ts`, `src/audio/audioRenderer.ts`: worker task protocol, two render lanes, cancellation/reset and PCM transfer. Singing rendering should be lazy and independent of playback scheduling. Large model inference must not starve existing synth jobs.
- `src/features/studio/part-editor.tsx`: existing piano roll and parameter popovers are the basis for vocal editing; avoid creating a separate disconnected DAW.
- `src/server/audio-jobs.ts`: existing provider jobs handle asynchronous generated audio. They are not a score-driven singing engine and do not supply note/phoneme controls.

## Engine options

| Route | First useful result | Strength | Limitation |
| --- | --- | --- | --- |
| TypeScript formant/source-filter synthesis in a Worker | Sustained vowels, then consonant/vowel syllables at scored pitches | Small, deterministic, editable, no model downloads or server inference | Deliberately synthetic/robotic; not comparable to neural singing naturalness |
| Browser ONNX acoustic model plus vocoder | Model-supported lyrics and melody rendered to PCM | Potentially natural singing with local inference | Requires a compatible voice model, phonemizer, duration/pitch processing, vocoder, browser operator support and measured memory/latency |
| External/local inference adapter | Score rendered by an independently installed engine | Broader model/runtime choices | Adds installation or service requirements; would change the currently agreed browser-synthesis boundary |

If the goal is to build our own small engine and hear it early, the first route is the narrowest experiment. If natural Mandarin singing is required from the first release, start with model/voice selection and a measured phrase-rendering spike; do not present a formant voice as a substitute for that requirement. No route is selected yet.

## Common editing and rendering design

1. Reuse the piano roll for a monophonic vocal source. Preserve existing instrumental polyphony. Represent rests explicitly or derive them from score gaps; do not silently drop overlapping vocal notes.
2. Store editable lyrics per note and allow explicit syllable/phoneme overrides. Sustain across notes needs a continuation marker. Language-specific tokenization and pronunciation remain dependent on the chosen first language.
3. Separate score, pronunciation, expression and rendered PCM. Keep editable pitch offsets/vibrato in the document; do not bake the only copy into audio.
4. Render phrases in a Worker and cache by score, pronunciation, voice/engine version, sample rate, tempo and expression. Tempo and edits invalidate affected phrases. Late results from older revisions must not replace current audio.
5. Feed completed PCM through the existing transport, mixer and export path. Editing can show rendering/error state, but never block unrelated tracks or start network inference from a transport callback. Missing vocal output must be visible rather than silently exporting an incomplete song.
6. Cancellation, editor closure, project change and undo invalidate obsolete work. Playback and WAV export must use the same accepted score and render implementation.
7. Producer tools edit lyrics and parameters through the same commands. A song generator or speech API must not be substituted for controlled singing synthesis.

## First implementation slice after scope selection

- One voice, one language/phoneme inventory and one monophonic vocal clip.
- Note-aligned lyrics, syllable continuation, pronunciation correction and visible render state.
- Pitch, note length and volume; modest portamento/vibrato where supported by the chosen engine.
- Playback, clip loop, mix/export, undo, save/reopen and legacy-project compatibility.
- Short original or public-domain test phrases, with an audible output artifact for evaluation.

Do not start custom model training, voice cloning, multiple singer presets, full multilingual support, genre-reactive effects or a new backend service in this slice.

## Evidence required before committing to a model route

Select an actual voice/model release, read its own license and data/redistribution terms, and inspect its inputs/outputs. The engine code license alone does not establish voice-weight availability or usage permissions. Verify acoustic-model, vocoder and phonemizer compatibility together.

Benchmark cold initialization, warm phrase rendering, peak memory and cancellation on a named browser/device using 2-, 5- and 10-second phrases. Report render time divided by audio duration, not an unmeasured real-time claim. Test the browser's actual acceleration path and unsupported-device behavior. No singing latency or quality measurements have been made yet.

For either route, verify note timing, stable pitch, sustained syllables, rests, transitions and click-free phrase boundaries, then listen to the result. Test rapid edits/undo and stale render disposal; verify sample export matches playback. Run the build and focused command/DSP tests, and inspect desktop/narrow keyboard interactions.
