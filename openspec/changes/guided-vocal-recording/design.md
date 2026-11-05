## Context

See proposal.md for motivation. The studio currently has no getUserMedia or microphone capture implementation. `AudioEngine` in `src/audio/audio.ts` owns arrangement playback and clip audition; `use-audio-session.ts` can resolve synthetic vocals before playback. Recording must not depend on that asynchronous synthesis path. Existing uploads accept `kind=reference`, while `uploadAudio` currently only sends a file. Project edits use a serialized versioned commit queue and shared navigation protection.

Uncommitted `part-editor.tsx` and new `editor-playback.ts`/tests predate this change. Preserve them and integrate against their accepted editor-range behavior; do not restore or replace those files wholesale.

## Goals / Non-Goals

Goals: a short path from a vocal source to a usable microphone take with stable visual timing and downloadable audio; explicit persistence with enough original cue context for future analysis.

Non-goals: inferred alignment or expression transfer, accompaniment playback, live monitoring, pitch correction, background sessions, or changes to the singing worker/Producer skills. Visual cues provide the minimum useful singing guide without requiring current synthetic voice quality.

## Decisions

### Focused vocal recording dialog

Add `src/features/studio/vocal-recording-dialog.tsx`, opened by a vocal-only Record reference control in `part-editor.tsx`. Use shared modal semantics and an explicit state machine: idle, preparing, count-in, recording, review, saving. Display current/next lyric groups, a horizontally scrollable source ruler with timed lyric blocks, elapsed/duration and a real input-level meter. Review shows a waveform derived from the captured PCM. Do not add a permanent panel or globally expose a recorder.

Freeze an accepted source/version/tempo snapshot on start. Opening from a trimmed arrangement clip still records the entire vocal source, matching `editorPlaybackClip`; placement later aligns the source origin to the selected instance's `start_beat - offset`. A source opened from the library defaults to beat zero. A resulting negative placement uses a nonnegative placement start and matching audio offset to preserve alignment.

### PCM capture on one browser audio clock

Add `src/audio/vocal-recorder.ts` and `public/audio/recording-worklet.js` (or the repository's verified worklet asset convention). Use AudioWorklet input PCM capture and mono PCM16 WAV, rather than MediaRecorder container timestamps/codec padding. Capture blocks include absolute sample-frame indices and are gated against the scheduled start frame. Derive cues/count-in from that AudioContext clock and derive the saved take from captured frame counts. The worklet acknowledges the final capture frame before WAV encoding; UI animation timestamps are never the recording authority.

Keep the microphone path separate from audible clicks: microphone source -> capture worklet -> silent output; the optional count-in uses a separate output branch. Never connect microphone audio to a nonzero monitoring gain. Close the dedicated context and stream when finished; a frozen take retains PCM/blob and cue data without retaining the microphone. Permission setup and worklet readiness complete before starting the countdown, without contacting the server. Use the existing WAV helper if compatible, otherwise a small tested PCM encoder. Do not add dependencies.

One source bar lasts numerator * 4 / denominator quarter-note beats. Stop finalizes at the current frame; auto-stop uses source duration plus a 250ms release tail. Preparation and re-record sessions carry generation tokens so late permission/worklet responses cannot revive a cancelled capture. Preserve the prior completed take until a replacement yields valid PCM. Device interruption or hidden-document capture stops produces a clearly interrupted take if usable.

### Score cue model with explicit timing provenance

Add `src/features/studio/vocal-recording-cues.ts`. Build cues from ordered notes and accepted syllable/continue assignments. Use matching explicit phoneme or syllable budgets only when their mapping is unambiguous; otherwise divide within-note syllables as estimated guides, preserving displayed grouping. Continuation notes sustain the final syllable. This is not forced alignment or a claim about actual pronunciation times. Cue tests cover imported fractional timing, missing lyrics, rests, polyphonic/overlapping input and grouped syllables; ambiguous overlapping cues remain visible rather than rewriting the score.

### Reuse media and versioned project editing

Extend `uploadAudio` with an optional kind argument that retains its existing default for other callers. Add optional `reference_recording` metadata on audio sources in `src/shared/schema.ts`: source/project/version identity, tempo/meter, source-range origin, captured sample rate/origin and immutable lyric cues including timing provenance. Validate this at the existing source.add boundary and preserve it through save/load. No new ProducerCommand, SQLite table or migration is needed because project JSON already carries sources. Existing documents omit this field.

Have `studio-page.tsx` coordinate Save reference: upload a WAV with reference kind, then atomically enqueue source.add, part.add, track.add (a new muted reference track), and clip.add at the source-aligned origin. Freeze UUIDs for a take/save attempt and retain the asset on retry after a failed command, avoiding unnecessary repeat uploads. Commit success is the sole acceptance point; a failure retains the local take. An uploaded asset without an accepted placement is not a project edit; media cleanup follows existing asset lifecycle. New reference playback is explicit, with no duplication of active synthesized vocals.

Save reference saves into the current draft only; file-menu Save/Save as still persists the project. Download is available independently of network/upload limits. Keep the original synthesized source editable.

### Shared lifecycle and unsaved protection

Pass recording ownership to `studio-page.tsx` so it can stop arrangement/clip playback and block conflicting shortcuts. Integrate active capture, pending upload/commit and an unsaved completed take with the existing save tracker and single navigation/discard dialog; do not replace the global guard with a second recorder-specific handler. Cancellation of departure keeps the take. Permission/capture disposal happens on confirmed discard and unmount. Snapshot changes during capture stop and retain the original-context take instead of retiming it silently. Shared top-center toasts report failures and deduplicate recurring device errors.

## Risks / Trade-offs

- Hardware input latency is not automatically measured -> retain sample-frame origin and available device latency hints, label cues as guides, and leave precise audio-to-score alignment to later offline analysis.
- A silent visual guide requires the singer to know the melody -> keep the score visible and optional headphone count-in available; accompaniment and guide-tone routing are a later scoped extension.
- Browser microphone policies vary -> feature-detect secure-context, worklet and device availability, show actionable toasts and keep captured WAV download available even if persistence fails.
- Long takes consume PCM memory and may exceed existing upload limits -> reuse established server errors, keep local download/retry, avoid introducing arbitrary new capture limits.
- No physical microphone is guaranteed in automated tests -> combine clock/PCM/session tests with a browser-generated synthetic input harness and an explicit real-microphone manual check before claiming acoustic validation.

## Migration Plan

No database or hosted adapter migration. Deploy optional JSON metadata and browser UI together; existing source documents and upload callers remain valid. Roll back the entry point and capture module without deleting uploaded media or accepted audio sources; readers preserve supported source metadata. Existing filesystem/SQLite media persistence stays unchanged.
