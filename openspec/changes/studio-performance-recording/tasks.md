# Tasks

## 1. Shared musical clock and metronome

- [x] 1.1 Implement meter pulse planning and click scheduling in browser-audio utilities; verify pulse spacing, bar accents, seek alignment and cancellation for 4/4, 3/4 and 6/8. Count-in integration remains outside the selected first slice.
- [x] 1.2 Separate AudioEngine preparation from scheduled playback and let VocalRecorder use an externally owned audio clock without closing it; verify accompaniment onset and worklet capture frames share the selected start time, and existing recorder/load tests pass.
- [x] 1.3 Add the transport metronome toggle with session-local state; verify independent practice, playback alignment, seek/tempo changes, pause/stop/disable cleanup, keyboard focus and desktop/narrow layouts; document the controls and exclusion from WAV export. Recording/count-in configuration remains deferred by the user's scope selection.

## 2. Direct recording to audio tracks

- [x] 2.1 Add a transport recording action with minimal microphone/count-in configuration, using the shared scheduler without requiring a vocal source; verify readiness precedes count-in, cancellation creates no empty Clip, and existing reference recording still works; document the entry.
- [x] 2.2 Automatically upload each completed recording and place it as an ordinary audible audio Clip on a new track at its captured origin through a typed undoable draft batch; verify timing, real waveform display and no separate keep-take/Save reference step or implicit project Save.
- [x] 2.3 Make re-recording create another normal track/Clip while preserving earlier recordings and their state; verify repeated recordings can be compared, reused, trimmed, moved and deleted using existing arrangement and mute/solo controls, with no dedicated A/B, take-list or chosen-take interface.
- [x] 2.4 Preserve recovery PCM for interrupted captures or failed uploads/placement; verify version/lock conflicts, idempotent retry, Undo and departure protection without adding a recording-management surface; document recovery behavior.

## 3. Producer control and voice handoff

- [x] 3.1 Add runtime control schemas, initiating-browser identity and server request/acknowledgement handlers patterned after browser rendering; verify project/version ownership, duplicate delivery, cancellation, disconnected browsers and no execution from historical events.
- [x] 3.2 Add Producer metronome/play/prepare-recording/stop tools and their browser handler; verify real acknowledgement before success, unavailable-permission/audio states and no direct project mutation bypass; update capability/instruction documentation.
- [x] 3.3 Hold realtime microphone uplink and speech during counted capture, and release armed recording only after local preparation speech drains; verify user interruption cancels an armed plan, singing never becomes a chat turn, and resume does not greet or play call cues again; retain the current voice and provider-default VAD sensitivity.

## 4. Integration and hardware verification

- [x] 4.1 Run type checking, relevant audio/Producer/project tests and production build; verify the new transport/dialog on desktop and narrow widths and preserve existing playback/export/reference-recording behavior.
- [ ] 4.2 Verify recording with a real microphone and headphones: spoken four-click request, accompaniment plus recording, re-record to another track, compare using mute/solo, Undo, Save and WAV export; record timing/latency limits and only mark hardware checks passed after direct observation.
- [x] 4.3 Update the architecture documentation to match verified direct-to-track recording and comparison through ordinary track controls.

## 5. Conversational bounded recording and file tools

- [x] 5.1 Require segment, destination and finite start/end beats in the recording tool, with count-in/accompaniment/follow-up; validate ranges, target ownership and locks, and remove the underspecified transport recording path.
- [x] 5.2 Schedule finite capture and optional silent accompaniment locally; place into the declared target with deterministic receipts while preserving manual/reference recording and recovery.
- [x] 5.3 Persist owned recording lifecycle acknowledgements and verify accepted Clip/asset/receipt before returning fresh context; cover duplicate, stale, foreign and cancelled requests.
- [x] 5.4 Resume realtime/text Producer from verified recording completion and the requested follow-up, without fabricated user speech, repeated greetings or duplicate analysis; preserve speech-drain/interruption behavior.
- [x] 5.5 Connect acknowledged Save/Save as and WAV export tools to existing file actions, with version-safe results and no staged-edit bypass.
- [x] 5.6 Validate tool schemas and actual mocked tool loops, finite worklet capture, placement/continuation, browser synthetic input, typecheck and build; update capability documentation and leave real microphone rehearsal explicit.

## Software verification

- Shared-clock recording, automatic ordinary audio placement, repeat recording, recovery and Producer control are implemented. Real microphone/headphone rehearsal remains pending in task 4.2.
- Metronome timing and engine integration tests cover meter accents, late-timer recovery, cancellation, seek offsets, waiting for an existing practice grid on song start, joining an existing song grid on enable, and no clicks in offline export.
- Full suite: 274 passed, 3 skipped. Type checking and production build passed. Focused lint reports advisory hook warnings; there are no lint errors in the new control/scheduling/UI files.
- Browser verification used an independent built-in example draft with synthetic input: four-click capture, no-count-in capture, real audio waveforms, automatic placement, preserving the first recording's mute state while adding the second, failed direct upload followed by successful retry, Undo, and cancellation before a delayed microphone result. No saved project was changed.
- Desktop and 390-pixel layouts show Record beside Mixer, Recording with a stop icon while active, recording settings in the upper-right header, and Undo beside split/copy/delete. The standalone Audio upload action is absent. Settings close with Escape and restore focus. Synthetic input overrides were removed; real device latency and the complete spoken recording workflow were not claimed as verified.
- Real Producer/browser verification: an underspecified humming request asked for missing details and emitted no control. An explicit phrase/new-track/0–4 beat/dry/no-count-in request automatically captured 2.142875 seconds, stopped and placed the Clip, then started one audio-to-notes continuation. A capture-synchronized synthetic C4/D4/E4/G4 input became four editable notes on a muted instrument track; original audio and prior recordings remained unchanged. Only an isolated example draft was modified. Browser input/worklet overrides were removed and viewport reset. Requested transcription was explicit in the test; ordinary humming/singing defaults to retaining audio.
- Mocked real SDK tool loops verify required recording schema, real browser failure acknowledgement, deterministic continuation and serialized Save as followed by export using the new saved version. Audio tests verify finite worklet frames, silent capture and an output gate/metronome horizon independent of delayed main-thread cleanup.
