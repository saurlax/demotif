# Design

## Context

Current implementation includes StepAudio Realtime, male voice, contextual greetings, spoken interruption, call cues, bounded conversational recording and requested audio-to-notes continuation. Real microphone/headphone rehearsal remains pending.

### Recording workflow capabilities

| Workflow | Observed implementation | Remaining work |
| --- | --- | --- |
| Continuous spoken Producer, warm male voice | `src/server/producer-realtime-session.ts`, `src/audio/realtime-voice.ts` | Implemented; keep the selected voice and provider-default sensitivity/timing. |
| Hum four notes and see editable notes appear | Explicit `record_audio` captures the agreed phrase/range/target; verified placement resumes the conversation and requested offline `transcribe` creates editable notes | Implemented and tested with real Producer plus synthetic C/D/E/G. Humming defaults to audio; notation is explicit, not continuous live pitch tracking. |
| Drag a note longer, quantize and edit drums | `part-editor.tsx` supports dragging, resizing, transpose, Quantize and drum editing | Implemented. |
| Workbench metronome | Implemented transport toggle and shared-clock scheduling with alignment in both directions | Completed first slice. |
| Four clicks then accompaniment and capture | Shared studio clock, finite worklet range, scheduled accompaniment/output gate, count-in and bounded metronome horizon | Implemented; physical device latency still needs rehearsal. |
| Sing from an ordinary project | Record beside Mixer and chat-driven `record_audio`; no vocal source required | Implemented; reference score cues remain in the compatible reference workflow. |
| Record the phrase again | Each completed recording is an ordinary audio Clip; manual Record adds a track and chat specifies a new/existing audio target | Implemented; old audio and mix state are preserved. |
| Producer controls recording/playback | Acknowledged metronome/play/stop, required bounded recording plan, Save/Save as and WAV export tools | Implemented; browser owns permission and audio timing. |
| Hear recorded vocals in the mix | Ordinary audio Clips, mixing, mute/solo and WAV export | Implemented. |
| Replace a sung line | Existing Clip split, trim, move and imported audio support manual assembly | Direct recording-to-Clip plus existing editing; punch-in/automatic comping remain separate. |
| Compare changes | Tracks, mute/solo and append-only Undo exist | Reuse these controls; the user excluded dedicated A/B and take-management UI. |

## Goals / Non-Goals

**Goals:** Land one complete performance flow with a four-click count-in and synchronized recording. Reuse the accepted project model, sound engine, recorder worklet and typed commands.

**Non-Goals:** See proposal.md. Keep existing reference-recording metadata and optional native singing behavior compatible.

## Decisions

### Bounded conversational capture

The dedicated `record_audio` tool requires a named segment, explicit existing audio track or named new track, start/end quarter-note beats, count-in, accompaniment and follow-up intent. General transport tools cannot bypass this contract. Producer resolves missing segment/range/destination in conversation before calling it; known selected Clips or named sections can supply a range when the user refers to them. Do not invent unresolved destinations or timing. Once resolved, the tool prepares recording without an application confirmation click, waits for preparation speech to drain, and arms the worklet with a finite end frame. Dry humming suppresses accompaniment and ongoing metronome clicks.

Capture metadata preserves target/range and control identity. Existing-track placement uses the normal locked-track/version checks; new-track placement preserves prior recordings. The owning browser reports scheduled/captured/placed/failed lifecycle events. Placement acknowledgement verifies the real command receipt, owned asset and deterministic Clip/source IDs before providing a fresh musical context. The verified result resumes an idle realtime conversation or starts a text Producer continuation; duplicate events never repeat capture, placement or analysis. User speech during pending upload takes precedence. Existing reference recording and manual Record remain compatible.

Save/Save as and WAV export are explicit browser actions with actual completion acknowledgements. They cannot mix with staged content edits in the same Producer run. Save advances the accepted draft version; export reports a completed download/shared export rather than inventing a saved file. Browser permission failures remain actionable without fake success.

### Metronome and recording controls

Enabling the metronome while stopped starts practice clicks. Starting playback with practice clicks running waits for the existing pulse grid after preparation; mid-beat positions preserve their offset. Enabling it during playback joins the next song pulse. Pause silences clicks while retaining enablement for resume. Stop disables and silences the metronome. Disable, project departure and engine release cancel queued clicks. Settings are session-local and never make the draft dirty or enter export. Record is a work action directly after Mixer, outside playback controls; it starts immediately using the selected settings and changes to Recording with a stop icon. Microphone/count-in settings live in the upper-right header. Undo is with split/copy/delete in the arrangement toolbar. The standalone Audio upload toolbar action is removed.

### One browser audio clock

Add reusable scheduling utilities under `src/audio/` for pulse timing and a short-lived metronome scheduler. `AudioEngine.getContext()` already exposes the studio context. Extend engine preparation and scheduled start APIs so a caller can prepare accepted-project assets first and then choose one future `when`; do not let `play()` replace the chosen onset with its current hard-coded `currentTime + 0.15`.

Allow `VocalRecorder` to use an externally owned AudioContext without closing it on dispose. Extract shared click generation from its current internal count-in. Arm the recording worklet using frame positions derived from the same chosen onset that starts accompaniment. Browser animation frames update displays only. Distinguish quarter-note beats from meter pulses: four-click mode is exactly four quarter-note pulses; one-bar mode uses the meter denominator. Clicks route directly to the local output, outside song mixing/export and microphone PCM assembly.

A separate clock per recorder plus wall-clock coordination would drift and is rejected. Render all needed assets before scheduling; never begin count-in while waiting for a network asset or synthesis result. Project or tempo changes invalidate an armed plan rather than silently shifting a recording.

### Session state and direct recording to tracks

Keep metronome enablement, count-in choice and performance phase in browser session state (`src/stores/studio.ts` and a focused performance hook). Place Record directly after Mixer in the work tools row; keep it outside the playback group. The upper-right settings button opens minimal microphone/count-in configuration. Record changes to Recording with a stop icon while active, with the countdown inside the same button. Do not add a second transport row, recording review workspace or take-management panel.

Extract capture coordination from `vocal-recording-dialog.tsx` so ordinary microphone recording requires no vocal source. Score and lyric cues remain optional and can reuse their existing surface. Each completed recording carries immutable origin, tempo, meter and capture metadata only until upload and placement are acknowledged. It then becomes an ordinary audio source/Clip on its own track. Re-record creates a new Clip/track, preserving earlier recordings and their mute/solo state. Listen and compare in the arrangement using existing playback and track controls. There are no selected-take IDs, take lists or dedicated A/B controls. Default live monitoring remains off.

On recording stop, automatically use existing media upload and typed source/track/Clip commands for placement. Add a performance-placement builder alongside `reference-recording.ts` rather than changing all reference saves from muted to audible. Every new performance track is audible by default; never silently mute or replace prior recordings. No separate Save reference or keep-take step is required for this flow; explicit project Save still controls persistence to the saved base. If placement fails or is stale, retain that recording's local PCM with retry/download recovery through the recording control and shared error notifications. Navigation protection covers pending uploads and unsaved PCM. Pending/failed recordings are recovery state, not a new media-management UI.

### Producer control bridge

Use the existing `producer-render.ts` event/request/claim/acknowledgement pattern as a seam, with a separate runtime control schema and handler. Add a text Producer tool for `metronome`, `play`, `prepare_recording` and `stop`. Realtime already delegates musical requests into that Producer. Include project/version, request ID and initiating browser client ID; propagate the client identity through text and realtime submissions. Other tabs cannot claim it. Keep request lifecycle and acknowledgement events project-scoped, single-owner and idempotent; never replay completed or historical requests.

The tool reports prepared/armed state separately from actual capture and project placement. Activate/resume the shared studio AudioContext from the user's voice-entry or transport gesture; if browser audio or microphone permission still needs a local action, return that state instead of claiming recording began. Server run cancellation aborts pending preparation/count-in, while a captured take remains recoverable.

### Voice handoff and spoken preparation

Introduce a local performance hold in `RealtimeVoice` and its hook. After Producer has prepared recording, schedule the pending count-in only after the local spoken preparation reply has drained. On entering count-in, clear pending conversational audio and hold microphone uplink; the recording input remains active through its own worklet on the studio clock. End capture and restore conversation without recreating the Realtime connection, greeting or call cues. Do not change the provider-default VAD parameters or selected voice.

Preparing is cancellable. If the user interrupts the preparation reply before countdown starts, cancel the pending plan and continue conversation. For text-triggered recording, start from an explicit local action or an already-ready browser context. Do not use an agent message, timer callback or network response to mark individual click times.

## Risks / Trade-offs

- Loudspeakers can bleed count-in/accompaniment into recorded vocals → recommend headphones at the recording control; keep monitoring off and never digitally mix clicks into recorded PCM.
- Capture device latency can shift a performance → preserve frame/latency metadata, retain manual Clip positioning, and validate the real capture path before claiming sample-exact acoustic alignment.
- Changing a project during capture or saving → stop new scheduling, preserve captured PCM and enforce version checks for acceptance.
- Multiple browser tabs can duplicate control work → propagate initiating client identity rather than relying solely on first-claim leases.
- Voice and music use different contexts → use a local voice-output-drained acknowledgement to begin the already-prepared performance; all musical events after that boundary share the studio clock.

## Migration Plan

Add shared scheduling without changing saved project geometry. Preserve reference recording metadata and existing audio assets. Introduce direct recording-to-Clip and the control bridge incrementally behind capability discovery, then update Producer instructions to advertise only completed capabilities. After tests and build, verify the four-click count-in, recording, re-recording and comparison through normal track controls using a real microphone and headphones. No new cloud provider or dependency is required.
