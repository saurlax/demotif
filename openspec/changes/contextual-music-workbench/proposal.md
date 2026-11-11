# Proposal

## Why

Demotif can stage generated media and reversible edits, but its remote model capabilities need explicit discovery, piano editing is limited to one note, and Producer interaction requires a sidebar. Contextual generation and visible, truthful editing feedback should let users work directly with musical material while retaining project control.

## What Changes

- Add a capability-based provider catalog: songs/instrumentals, speech, sound effects, score-driven singing, and audio-to-notes analysis. Connect verified OpenRouter speech models; exclude the removed Lyria music presets; use OpenRouter for all remote models and retain native singing/analysis independently.
- Add piano-roll left-drag marquee selection, additive selection, group movement in pitch/time, and group duration resizing with one atomic accepted edit per gesture.
- Add Clip context actions for rendering notes to audio, generating an AI audio variation where supported, and analyzing audio into notes. Add empty-arrangement location actions for generating audio at a captured musical position.
- Add an empty-input microphone entry and turn-based voice conversation through OpenRouter transcription, the selected Producer, and TTS; retain typed context and sidebar history. Native full-duplex Realtime transport is not claimed.
- Make a floating contextual Producer composer the default, with an optional conversation sidebar. Anchor it to right-clicked Clips or explicit empty-space targets without losing the draft, conversation, or running task.
- Add an animated Producer cursor and concise streamed text tied to actual tool targets, pending proposals, job stages, and accepted edits. Keep proposed changes visibly distinct from accepted document state.

## Capabilities

### New Capabilities

- `audio-provider-capabilities`: Categorized provider/model availability, validated generation requests, durable media jobs and safe publication.
- `piano-note-selection`: Marquee selection and atomic group note transforms.
- `contextual-clip-audio`: Clip conversion, generated variations, audio transcription and location-specific generation.
- `contextual-producer`: Floating composition, shared conversation lifecycle, semantic targets and truthful operation feedback.

### Modified Capabilities

None. The main specification inventory is currently empty; related in-flight changes remain independent.

## Impact

Touches browser editing/audio export, server model commands and run events, and provider/media adapters. Existing draft, expected-version, lock, undo, owned-media/S3 and browser audio boundaries remain authoritative. Completed stored media and project identifiers remain available; removed remote jobs cannot be resumed.

Affected areas include `src/features/studio/`, `src/components/app-shell.tsx`, `src/stores/studio.ts`, `src/server/audio-jobs.ts`, `src/server/producer.ts`, `src/server/api.ts`, `src/server/config.ts`, `src/shared/schema.ts`, `src/audio/`, and `.env.example`. No provider credentials enter client bundles, prompts, events or tracked files. No new dependency is presumed necessary.

Non-goals: Suno access acquisition or scraping; unverified Eleven Music/MiniMax Music/Stable Audio integrations; voice training; guaranteed MIDI-conditioned singing from prompt-only models; automatic acceptance of AI edits; whole-song provider playback; adaptive ambient themes. Provider integrations without credentials or verified capability are shown as unavailable rather than silently substituted.

## ElevenLabs provider revision (2026-11-08)

The user authorizes direct ElevenLabs audio models. DEMOTIF_ELEVENLABS_API_KEY owns music, one-shot/loop effects, TTS, voice conversion, speech isolation, recognition and alignment. DEMOTIF_LLM_API_KEY and DEMOTIF_LLM_BASE_URL are reserved for language and future Realtime models. Remove OpenRouter batch audio routing. Keep native singing and audio-to-notes separate. Image/video, account administration, hosted agents and voice training are outside this audio integration.

## Unified contextual audio actions (2026-11-08)

Selected Clips and notes must support natural-language conversion from either Producer input. Context menus expose applicable audio operations and submit ordinary Producer instructions with the captured reference. Add a browser render tool bridge so the agent can faithfully render accepted notes/current instruments without moving real-time audio server-side. Add verified Eleven Music uploaded-audio conditioning for stylistic variations, preserving truthful exact-note limitations. Other audio operations use the same tools, context, history and review path.

### Producer interaction revision (2026-11-08)
New Producer runs automatically commit their completed validated command batch to the editing draft as one undoable operation. This replaces the earlier explicit Apply requirement in this change. Version checks, locks, command validation and explicit Save remain. Existing unaccepted historical runs are never automatically replayed. A conflict retains results and reports an actionable toast. The sidebar exposes Undo changes only while that run is the latest undoable version; Ctrl+Z uses the normal workspace history.

Model selection belongs at the lower-right of the message input. Voice-chat entry uses the waveform icon in both composers. Producer text renders as Markdown directly without assistant bubbles. The independent Audio results list is removed: generated musical content is placed through the same command batch, and text analysis is returned in the conversation.
