# Design

## Context

OpenRouter supplies all remote model capabilities. Native singing and local analysis remain subprocesses. Shared typed edits, browser audio, durable owned-media publication, draft saves and operation history remain authoritative.

## Goals / Non-Goals

Provide categorized models, contextual actions, group note editing and truthful Producer activity. Remote models do not promise exact-note preservation, regional access or unsupported reference conditioning.

## Decisions

### 1. OpenRouter capabilities and connection

Discover music and speech catalogs independently. All text/music/speech requests share DEMOTIF_LLM_API_KEY and DEMOTIF_LLM_BASE_URL, defaulting to the official OpenRouter API. Controls and readiness follow verified model contracts. Decode complete music streams; use documented speech PCM metadata. Unsupported categories are unavailable. Never expose credentials.

### 2. Durable jobs and publication

Persist explicit OpenRouter model, accepted musical context and job identity. Unknown remote outcomes cannot be resumed or resubmitted automatically. Validate and normalize output before S3 publication and typed acceptance; completion alone neither edits nor saves a draft. Completed stored media remains available after adapter changes. Local transcription uses the captured range independently.

### 3. Local group gesture snapshots

Extend `note-editing.ts` with pure rectangle hit-testing and group-transform math. In `part-editor.tsx`, track a selected ID set, an active note ID, and one gesture snapshot containing original notes, grid/viewport mapping and project/source version. Keep the current single-note modal behavior for clicks. Shift-click toggles membership without opening the modal; dragging a selected member retains the group.

Defer empty-space creation until pointer-up if movement stayed below the existing 3px threshold; crossing it enters marquee mode. Start rectangles and note bounds use scrolled musical coordinates. Edge-scroll updates the same transform and does not use stale client coordinates. A source change cancels the gesture.

Move groups using a shared time delta snapped to NOTE_GRID and an integer pitch delta, bounded by the tightest member. Resize right edges with a shared snapped duration delta, not proportional time stretching; keep starts/pitches fixed and imported offsets untouched. For vocal sources, constrain or reject transforms that violate accepted monophonic/continuation rules; preserve unchanged note IDs, pronunciation and expression. One `source.update` contains the complete final note list, committed only on release through `StudioPage.commit`. Gesture previews never enter the project cache as accepted state. Failed edits keep selection and use the existing toast.

Extend arrow-key movement and Delete to the group. Select-all is scoped to the editor, ignored in inputs and dialogs. Escape first cancels the active gesture before editor-close handling. Right-click note deletion remains per-hit behavior, separate from arrangement Clip context menus.

Alternative: submit each note or pointer move independently. Rejected because it creates partial edits, excessive versions, stale vocal assignments and jitter.

### 4. Contextual actions and conversion semantics

Add a typed context intent in `src/shared/schema.ts`, with project version, source/Clip/track IDs, captured source window and destination beat. Add context menus in `arrangement.tsx` through the existing shared Base UI context menu components. Empty-background click selects a musical anchor; its contextual action menu exposes Generate sound. Menus only configure actions; submitting the contextual composer starts paid work.

Create shared action orchestration in `src/features/studio/clip-audio-actions.ts` and server validation as needed. Keep generated media and proposed commands accessible from the common session even when the language agent is unavailable. The composer supports category/model controls plus concise required options inside a popover/dialog invoked by an explicit action, not a permanent generation panel.

- **Render as Sound:** use existing browser offline rendering/export DSP for the captured Clip, including source offset, duration, instrument, Clip playback settings and relevant track processing. Do not include unrelated tracks. For vocals, use current matching native singing assets via the existing preparation path. Upload using current media ownership/S3 flow, then stage a new audio source, library entry and placement for acceptance.
- **Generate Sound variation:** generate a new candidate from supported prompt/lyrics controls and a descriptive musical context. Initial Lyria listings do not establish audio-reference conditioning; do not send a reference file or promise exact melodic preservation. Show that this creates a new interpretation before submission. Future reference-capable models can use the same intent without changing accepted document semantics.
- **Convert to Notes:** materialize an owned source, slice the captured offset/range before local analysis, preserve the 30-second analysis limit and pitch/percussion options, then convert seconds to beats at the captured tempo. Offer range selection for longer Clips; do not truncate implicitly. Stage a note source, library Clip, muted new track and captured placement. Do not attempt full mixed-song polyphonic accuracy guarantees.
- **Generate here:** capture track and snapped beat in empty arrangement space. If there is no existing track, stage a new compatible track. Reject a locked destination. Preserve actual measured generated duration; fitting or trimming is a later explicit edit.

All conversions preserve the original Clip and use explicit preview/acceptance. Place results alongside the original; muting/removing/replacing the original requires a separately selected command. Before accepting, use expected_version and recheck target existence, fingerprints, ownership and locks. Recoverable results can be retargeted explicitly after a conflict. Avoid modifying a shared source in place when converting one of its placements.

### 5. One Producer controller, two presentations

Move capability loading, run loading, SSE effects, send/apply/cancel and audio-action state from `producer-panel.tsx` into `use-producer-session.ts` or an adjacent controller hook, mounted once by `studio-page.tsx`. The sidebar and new `producer-composer.tsx` become views of one controller; there must be only one event subscription per active run. No independent duplicate composer draft.

Add studio-specific controlled right-panel state to `app-shell.tsx`, default closed in an open project. Keep existing horizontal sidebar transitions and departure guard. Floating composer is present only in projects and initially rests near the lower usable arrangement edge. Explicit Clip/background targets relocate it near the selected object, with viewport clamping, target labels and retained input focus. Keep long history and detailed review in the optional sidebar; the floating view contains only the message input and send/stop control, while output, audition and Apply are sidebar-only.

Pending remote work, local renders/uploads, acceptance and uncommitted prompt input participate in `hasUnsavedChanges`; canceling a departure retains all state. Context relocation does not rewrite an active run's snapshot. On narrow screens, the composer uses a compact usable viewport anchor and details use a drawer. Closing an editor or panel does not unmount the session.

Alternative: keep panel-mounted effects and hide it with CSS. Rejected because it leaves lifecycle coupling and makes responsive duplicate surfaces easy to subscribe twice.

### 6. Semantic feedback, not an automated mouse

Add a runtime-validated target union for Clip, source-note IDs, track, musical range and project. A captured context travels with the run and is checked server-side. Persist additive `activity` events with operation ID, target, phase and concise public text. Derive edit targets from validated typed commands, and emit processing/review/application events from real transitions, including direct audio actions.

Add `producer-cursor.tsx` and a target resolver shared by arrangement and editor. Register current entity elements/musical geometry, update bounds on scroll/resize/zoom/panel changes, and resolve logical beat/pitch targets at render time. Overlay elements use `pointer-events:none`; the cursor has a distinct label/shape from the user's pointer. Offscreen/missing targets get a compact named status rather than fake coordinates or unsolicited scroll jumps.

Move the overlay with restrained spring-like CSS transitions and show actual streamed text near its real target. During staging show Proposed; during server acceptance show Applying; only the acknowledged result becomes Applied. Atomic multi-target edits remain one transaction; presentation can visit their locations without pretending separate commits. Cancel/error terminates travel promptly. Under reduced motion use immediate positioning and a static target outline. Animation must not move actual note/Clip geometry or gate audio/command execution.

### 7. Validation and documentation

Add meaningful tests for provider response decoding/validation, uncertain submission, compatibility hashes, independent readiness, target capture and version/lock rejection. Add pure tests for multi-note delta bounds, snapped duration changes, import preservation, selection hit-testing and vocal metadata. Test session reconnect/deduplication and real phase/target events. Use mocked provider fixtures in automated tests and a small bounded live sample for each enabled operation during implementation; never retry paid failures blindly or include secret-bearing fixtures.

Manually verify desktop and narrow screens with long Clip names, scrolling, numeric controls, modal shortcuts, keyboard focus, selection cancellation, reduced motion, optional sidebar, stale targets and native/internal departure prompts. Run typecheck, relevant tests, lint and frontend build. Keep screenshots and generated evaluation audio outside tracked source. Document supported categories, limits, configuration and interruption recovery in README and docs/architecture.md.

## Risks / Trade-offs

- [Music prompt adherence is probabilistic] -> Keep generation separate from faithful rendering and show actual output for audition before placement.
- [Catalog entries and preview contracts change] -> Fetch categorized metadata, bound adapter support and validate provider failures without silently selecting another model.
- [Paid requests can finish after local interruption] -> Persist upstream identity where available and retain uncertain status without automatic resubmission.
- [Shared sources and vocal metadata amplify bulk edits] -> Transform stable IDs atomically and retain normal server lock and schema checks.
- [Floating UI can obscure musical content] -> Clamp beside targets, use a compact rest position, support drawer details and preserve keyboard access.
- [Concurrent existing S3 and vocal work touches the same files] -> Preserve current changes, use the established owned-media APIs and run regressions against the working tree.

## Migration Plan

1. Add capability/request/event schemas and provider adapters without changing legacy job routing. Add placeholder server configuration and an ignored project-local key at implementation time.
2. Enable verified OpenRouter models through independent readiness, keeping old OpenRouter payloads and recovery logic compatible. Add only additive database changes if new metadata requires them.
3. Introduce shared Producer lifecycle, contextual actions and group editor gestures, then switch studio panel default to closed and enable the floating views.
4. Validate existing draft Save/Save as, undo, uploads, native singing, S3 and playback/export alongside new actions.
5. Roll back presentation changes independently of provider support. Disabling OpenRouter must leave accepted owned audio playable and older jobs identifiable; never delete generated media or rewrite saved projects during rollback.

## References

- OpenRouter model catalog: https://openrouter.ai/api/v1/models
- Dedicated speech discovery and requests: https://openrouter.ai/docs/guides/overview/multimodal/tts
- Audio response documentation: https://openrouter.ai/docs/guides/overview/multimodal/audio
- Initial song models: https://openrouter.ai/google/lyria-3-pro-preview and https://openrouter.ai/google/lyria-3-clip-preview

Public catalogs were checked on 2026-11-07. Implementation live checks returned valid audio from ElevenLabs, MiniMax and Google speech. Both initial Lyria models returned a regional 403; real music-output validation remains incomplete. See tasks.md for verification evidence.

## Input-only Producer refinement

The floating composer has a 480 px maximum width, a single growing textarea and an aligned send/stop button. No title, model/category/settings controls, transcript or review popup is shown. Shared context captures accepted Clip/source/note IDs and musical position/range; both composer and sidebar send the same snapshot with the current accepted version. Context is persisted as a conversation event and shown as a concise reference in sidebar history. Stale or unrelated note/source references fail validation.

Remote generation and transcription go through the Producer tool loop, which discovers capabilities and selects a ready model without a user-facing model picker. Captured audio context is inherited by audio tools unless the agent supplies an explicit validated range. Clip rendering remains an explicit local browser action from the context menu, with audition/acceptance in the sidebar. Audio result polling continues while an agent run is active, even with the sidebar closed. Existing context/input survives panel toggles and repositioning.

Producer model selection is available only in the sidebar. The shared default catalog contains one DeepSeek Flash preset (`deepseek/deepseek-v4.1-flash`). A selected model is validated before run creation and persisted with the conversation; model changes cannot retarget an existing run. Audio model/tool selection remains agent-driven.

## Turn-based voice Producer

Research on 2026-11-07 found OpenRouter GPT Audio/GPT Audio Mini audio-in/out models but no public native WebRTC/WebSocket Realtime interface. Implement the documented STT → existing Producer → TTS workflow, retaining DeepSeek Flash and its tools. Empty input shows microphone; text shows send; active execution shows stop. Voice mode replaces the compact input with actual phase/interrupt/end controls rather than adding model settings.

Browser MediaRecorder owns capture; an analyser supplies actual voice/silence detection. Silence after speech ends a turn. Capture snapshots the accepted version and context, and never gates DAW transport. The server normalizes recorded bytes to WAV with existing FFmpeg, calls OpenRouter /audio/transcriptions with elevenlabs/scribe-v2, and discards microphone audio. The transcript enters the existing persisted/versioned Producer run with an input-mode marker. Its final public reply is synthesized with the verified minimax/speech-2.8-hd adapter. All requests share the existing key/base URL; no extra env vars, alternate providers, S3 dependency or stored voice assets are introduced for chat.

The browser supports manual interruption and re-listening, stops capture during reply playback to avoid acoustic feedback, and tears down tracks/recorders/analyser/playback/requests on exit, hidden document or unmount. No automatic paid retries. Permission/service errors use shared toasts. Failed/stale submissions retain transcript in the shared draft. Pending capture joins existing departure protection. Real microphone access is never started automatically on page load.

References: https://openrouter.ai/docs/guides/overview/multimodal/stt , https://openrouter.ai/docs/guides/overview/multimodal/audio , https://openrouter.ai/long-horizon . Synthetic fixture checks replace recording the user's ambient audio during verification.

## Authoritative audio routing revision (2026-11-08)

This revision supersedes earlier OpenRouter batch-audio decisions. Direct server-side ElevenLabs REST calls use DEMOTIF_ELEVENLABS_API_KEY at the official fixed API endpoint. Discover TTS/voice-conversion models and accessible voices independently; known Music v2/v2.5, SFX v3, Scribe v2, isolation and forced alignment use their documented contracts. Do not infer access to every endpoint from /models. Provider permission/balance errors are sanitized and never retried or substituted. Reject unsupported categories, model IDs, reference controls and isolated-vocal guarantees before submission.

Audio jobs retain server-owned source/range snapshots, stable identities, cancellation, no paid replay, measured duration, durable S3 publication and explicit draft acceptance. Speech recognition/alignment produce persisted text/timestamps without proposing note or audio edits. One-shot and seamless-loop effects use an explicit loop flag. Music with explicit lyrics uses the documented v2 chunks composition plan; instrumental requests use force_instrumental. Speech isolation is not full music stem separation.

Turn-based voice transcription/replies use direct ElevenLabs and do not require S3. Native full-duplex Realtime remains a separate, paused task and no new Realtime transport is implied. The LLM connection is never used for batch TTS, STT, music or SFX. No extra provider base URL or SDK dependency is necessary.

## Context-first conversion revision

Right-click actions send concise default instructions through the same Producer controller, with optional user style instructions supplied by the floating/side input. Menu opening alone never submits work. Rendering is no longer a browser-only menu bypass. A render_clip agent tool emits a persisted client_render request with validated accepted Clip context, name and optional built-in sound override. The mounted studio claims a request, renders an isolated project snapshot through the browser engine, uploads audio through STS and completes a run-owned result endpoint. Claims, results and errors are persisted and idempotent; reconnect recovers pending events. Cancel/project change aborts browser work. Server completion validates asset ownership, preserves stale media for explicit retargeting and stages typed commands without applying edits.

The Producer receives accepted instrument/sampler/drum metadata and selected timing/notes as context, without secrets or invented sample descriptions. All completed audio jobs share one command staging function so agent and direct result review use stable source/track/Clip identities and captured placement. Text results remain text.

Eleven Music v2/v2.5 supports uploaded audio via POST /v1/music/upload, returning song_id. Its upload is itself paid. A validated reference contains an owned audio source and explicit offset/duration (at most 30 s); note Clips are rendered first by render_clip. Capture a server-owned reference source snapshot. Upload the exact excerpt once, persist its identity immediately, then generate v2 chunks with conditioning_ref and condition_strength. Never retry uncertain uploads/generations or silently fall back to prompt-only output. This influences musical characteristics but is not exact MIDI rendering. Other tools only accept reference bytes through their verified contracts. Style-based audio-to-notes instructions can refine the staged note source after local analysis; analysis itself does not acquire musical style by changing a prompt.

References: https://elevenlabs.io/docs/api-reference/music/upload and https://elevenlabs.io/docs/eleven-api/guides/how-to/music/inpainting .

### Producer interaction revision (2026-11-08)
New Producer runs automatically commit their completed validated command batch to the editing draft as one undoable operation. This replaces the earlier explicit Apply requirement in this change. Version checks, locks, command validation and explicit Save remain. Existing unaccepted historical runs are never automatically replayed. A conflict retains results and reports an actionable toast. The sidebar exposes Undo changes only while that run is the latest undoable version; Ctrl+Z uses the normal workspace history.

Model selection belongs at the lower-right of the message input. Voice-chat entry uses the waveform icon in both composers. Producer text renders as Markdown directly without assistant bubbles. The independent Audio results list is removed: generated musical content is placed through the same command batch, and text analysis is returned in the conversation.
