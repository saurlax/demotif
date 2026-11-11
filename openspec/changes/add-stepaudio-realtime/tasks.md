# Tasks

## 1. Configuration and transport

- [x] 1.1 Extend server settings with STEPFUN_API_KEY, STEPFUN_BASE_URL and producer.realtime model/voice settings; verify configuration tests cover missing credentials, invalid endpoints, defaults and redaction; update .env.example and example config without secrets.
- [x] 1.2 Add the explicit Next Node entry point and authenticated ws relay with project validation, owning-backend handling and teardown; verify relay tests cover rejected upgrades, upstream errors, disconnect cleanup and unrelated Next upgrades; document local and hosted startup behavior.
- [x] 1.3 Update dev/build/start scripts for the entry point; verify dev HMR, production start, existing HTTP/SSE routes and audio HEAD/Range behavior still work.

## 2. Browser realtime speech

- [x] 2.1 Implement AudioWorklet microphone capture and streaming mono PCM16 conversion; verify 44.1/48-to-24 kHz sample counts, chunk continuity, clipping and byte order with audio tests.
- [x] 2.2 Implement session acknowledgement gating, streamed audio scheduling, response identity, VAD interruption, bounded queues and generation-guarded cleanup; verify mocked event tests cover late audio after interruption, hidden documents, project changes, disconnect and microphone permission rejection.
- [x] 2.3 Connect capability discovery and transport selection to both existing voice entry controls independently of text readiness; verify desktop/narrow layouts, keyboard focus, real state labels, absent-key fallback and deduplicated error toasts; document how to enable realtime.

## 3. Producer tools and conversation

- [x] 3.1 Implement edit_project delegation using the verified nested StepFun function definition and validate the current function-result/response event protocol; verify captured selection, stale versions, locks, one-active-run behavior and draft-only undo with existing Producer tests and new bridge tests.
- [x] 3.2 Correlate tool calls with input turns and deduplicate call IDs; verify repeated events create one run, interruption cancels owned pending work and accepted edits remain intact.
- [x] 3.3 Persist completed realtime transcripts and linked Producer runs through the conversation seam, refresh accepted draft changes and seed reconnect history; verify reload/history tests prevent duplicated transcript items and cross-project updates.
- [x] 3.4 Reconcile the pending contextual-music-workbench turn-based-only requirement and document the separation between realtime conversation, musical recording and audio-to-notes; verify OpenSpec strict validation and documentation match implemented fallback behavior.

## 4. Integration verification

- [x] 4.1 Run npm run typecheck, relevant automated tests and npm run build; resolve failures introduced by this change and report pre-existing unrelated failures separately.
- [ ] 4.2 Exercise a real session with streamed input/output, mid-reply interruption and one musical tool invocation on a disposable draft; verify the actual voice, draft edit, Undo, version conflict and session teardown. Perform microphone/speaker checks with a real permitted audio device; record any hardware check that needs user participation without marking it passed.

## 5. Voice interaction follow-up

- [x] 5.1 Simplify both active voice controls to hang-up only, preserving spoken interruption; verify desktop/narrow controls and the frontend build.
- [x] 5.2 Trigger one contextual greeting after microphone setup, keep it interruptible, and persist only assistant speech; verify acknowledgement/permission ordering, duplicate start events, late greeting suppression and live sessions with and without history.

## Verification record
- Call feedback: added short, quiet ascending/descending local PCM cues for realtime connection/disconnection. Connection feedback waits for microphone setup and precedes queued speech; microphone streaming excludes the cue window. Hang-up stops capture and replies immediately and closes the voice AudioContext after the disconnect cue. Voice lifecycle tests, type checking, focused lint and production build passed.
- Default-detection follow-up: session updates enable server_vad explicitly without overriding energy threshold, prefix padding or silence duration. Live audio comparison verified that omitting turn_detection disables automatic responses, while type-only server_vad detects speech and produces a reply. Client interruption remains driven by provider events.

- Follow-up: removed manual stop/interrupt controls from both voice surfaces; automatic interruption uses StepFun server VAD events and client playback-buffer cleanup. Thirty-four focused tests, type checking and frontend production build passed. Live new/history opening tests produced speech with no tool calls or provider errors; assistant greetings persisted without fabricated user transcript rows. The local server on 5173 was restarted with this follow-up.

- Type checking and production build passed. Full suite: 233 tests passed, 3 skipped across 52 files. Changed transport/audio/voice modules pass focused lint; the repository lint command still reports existing warnings elsewhere.
- Real StepFun streamed speech invoked the configured text Producer, changed an in-memory disposable draft to 95 BPM, returned 127 response audio chunks, and persisted one merged conversation item. Undo restored 120 BPM. No provider error was received.
- Live interruption: user audio started during a streamed reply; the interrupted response ended as incomplete and the following response completed without provider errors. Browser tests verify old playback is stopped and delayed old-response chunks are discarded.
- Isolated production and development servers returned HTTP 200 and completed realtime session configuration. Development HMR WebSocket upgraded successfully. Existing HEAD/Range and SSE disconnection tests passed. Desktop and 390-pixel layouts were inspected.
- Task 4.2 remains unchecked solely for a person speaking into a permitted microphone and listening through the actual output device. Cloud audio tests used a synthetic speech fixture; they do not establish local microphone quality, acoustic echo cancellation or perceived voice quality.
- Temporary verification servers on 5184/5185 were stopped. The pre-existing development process on 5173 was left running and needs restarting with the new npm script to serve WebSocket upgrades.
