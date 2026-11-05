# Record a singing reference

Open a project, select a vocal clip, and choose **Record reference** in its editor.

1. Select the microphone and choose **Enable microphone**. Allow microphone access in the browser; check the actual input-level indicator.
2. Choose **Record**. One bar of visual count-in precedes the source's lyric cues. Sing as the highlighted lyrics and playhead advance. Recording covers the entire vocal source, including when the selected placement is trimmed.
3. Choose **Stop**, or let recording finish automatically at the source end. **Listen** auditions the take; use the playback-position slider to seek. **Re-record** prepares another take, then **Record** starts its countdown. The previous take survives cancellation or a failed replacement.
4. **WAV** downloads the recording without uploading it. Share that file for listening and later timing/pitch analysis.
5. **Save reference** uploads and adds the take to the current editing draft. It creates a library audio clip and a new muted reference track, retaining the editable synthesized vocal. Use the project's file-menu **Save** or **Save as** to persist the project. Unmute the reference track explicitly when you want it in arrangement playback.

The recorder uses silent visual score cues. Optional **Audible count-in** should be used with headphones. There is no live microphone monitoring, guide vocal or accompaniment playback in this first version. The microphone is released after stopping, cancellation or closing. Reopening a saved reference is possible through its audio clip; its original timing context remains stored on the audio source.

Within-note lyric positions without explicit, unambiguous timings are marked as estimated with dashed cue boundaries. These are singing guides, not an analysis of your performance. Actual hardware input latency is not calibrated automatically. Human audio can depart from the displayed score; future offline alignment/expression extraction will use the preserved cue snapshot and captured audio. This change does not implement automatic expression transfer or modify the singing engine/Producer skill.

Closing an active recording or an unsaved take uses the existing unsaved-changes dialog. Cancel keeps the take; discard releases it. Refresh/tab closure uses browser-native departure protection. Failed uploads or conflicting saves keep download and retry available. If the page becomes hidden while recording, it finalizes available audio as an interrupted take instead of continuing invisibly.

## Implementation verification

- Unit/service tests cover cue grouping, continuations, authored/estimated timing, compound-meter count-in duration, negative placement origins, frame-gated capture, WAV encoding, permission races, interruption, atomic persistence and idempotent retries.
- Browser checks use a 220Hz synthetic microphone input without opening the physical microphone. They cover automatic and early stopping, take audition/download, failed re-record, upload failure, lost response after a successful command, retry without duplicate sources/tracks, shared discard cancellation, and desktop/narrow layout. Temporary browser mocks are removed by reload before delivery.
- A physical microphone and actual sung acoustic quality still require a user trial; synthetic-input checks do not establish device latency, room noise or pronunciation quality.

Validation for this implementation: `npm test` passed 118 tests (3 skipped optional integration tests); `npm run typecheck`, `npm run lint` and `npm run build` passed. Lint retains pre-existing project warnings, with no new recording-module warnings. Browser checks covered a 390px viewport and the normal desktop viewport. A downloaded synthetic take was mono 44.1kHz PCM WAV, 17.61s long, with a measured 220Hz dominant frequency; the test stream was released after stopping. A simulated lost batch response followed by retry left exactly one reference source and one muted reference track in the test draft; the saved song was not overwritten.
