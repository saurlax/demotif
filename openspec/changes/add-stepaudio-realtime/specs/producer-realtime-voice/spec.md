# Spec Delta

## Purpose

Enable continuous, interruptible Producer voice conversations that can delegate musical work to the existing validated project editing workflow.

## ADDED Requirements

### Requirement: Server-owned realtime connection
The system SHALL establish authenticated StepAudio 3 Realtime WebSocket sessions through its server. Provider credentials SHALL remain server-only and absent from browser payloads, URLs, logs and source control.

#### Scenario: Start configured realtime voice
- **WHEN** the user activates voice in an open project with realtime configured
- **THEN** an authenticated realtime session is initialized and microphone streaming begins only after session configuration is acknowledged
- **AND** the browser receives connection readiness without receiving the provider key

### Requirement: Continuous audio and interruption
The browser SHALL continuously stream microphone audio during an active session, play streamed response audio and show actual session state. User speech SHALL immediately stop queued old-response playback when detected, and late chunks for that response SHALL remain discarded.

#### Scenario: Speak over the assistant
- **WHEN** the provider detects user speech while an assistant response is playing
- **THEN** current playback and its queued chunks stop without ending microphone capture
- **AND** subsequent audio for the interrupted response does not resume playback

### Requirement: Provider default turn detection
Realtime sessions SHALL explicitly enable server VAD using provider-default sensitivity and timing, without application-supplied thresholds, silence timings or local volume-triggered interruption. Client playback cleanup SHALL follow provider speech-start events.

#### Scenario: Configure a realtime session
- **WHEN** Demotif initializes StepAudio Realtime
- **THEN** the session update enables server_vad and leaves sensitivity and timing settings unspecified
- **AND** microphone amplitude alone does not trigger application-defined interruption

### Requirement: Validated musical delegation
Realtime requests that edit music SHALL delegate to the existing Producer workflow with a server-captured project version and validated selection. Mutations SHALL preserve version checks, locks, undo and explicit project save semantics. The voice assistant SHALL report actual completion or conflict rather than claiming success before application.

#### Scenario: Edit a selected phrase by voice
- **WHEN** a spoken instruction asks to change selected notes
- **THEN** the corresponding turn captures the selection and project version before editing
- **AND** a successful Producer edit updates the draft once, appears in history and remains undoable

#### Scenario: The user edits during delegation
- **WHEN** the captured version becomes stale before Producer application
- **THEN** the current project is preserved and the failed operation is reported without silently retrying against a newer version

### Requirement: Idempotent tool and turn handling
The system SHALL correlate transcripts, audio responses and tool calls to their originating session and turn. Duplicate completed tool-call events SHALL NOT create duplicate Producer runs. Interruption SHALL cancel outstanding session-owned work where possible and never roll back accepted edits.

#### Scenario: Duplicate tool completion
- **WHEN** the same tool call completion is delivered more than once
- **THEN** at most one Producer run is created and its result is associated with the original call

### Requirement: Voice lifecycle and failure recovery
Ending voice, changing project, hiding the document, unmounting or losing the connection SHALL release microphone tracks, audio playback and sockets. Errors SHALL use deduplicated shared toasts. Reconnecting SHALL require an explicit user action and SHALL NOT replay edits or microphone buffers from a closed session.

#### Scenario: Leave an active conversation
- **WHEN** the project changes or the document becomes hidden
- **THEN** capture and playback stop, connections close and no late response updates the newly opened project

### Requirement: Compatible voice entry
When realtime is configured, voice entry SHALL use StepAudio independently of text Producer readiness for ordinary conversation. Musical delegation SHALL report unavailable text Producer configuration clearly. When realtime is unconfigured, existing ElevenLabs turn-based voice SHALL remain available. Mid-session failures SHALL NOT silently switch providers.

#### Scenario: Realtime without a text model credential
- **WHEN** realtime is ready but the text Producer is unavailable
- **THEN** spoken conversation works and musical delegation returns an actionable unavailable result without fabricating an edit

#### Scenario: Realtime is absent
- **WHEN** no realtime credential is configured
- **THEN** existing turn-based voice entry retains its current behavior

### Requirement: Unambiguous voice controls
Active voice UI SHALL show a hang-up action for ending the conversation without a separate stop, send-turn or interrupt button. Realtime users SHALL interrupt assistant speech by speaking; stopping the old reply SHALL retain microphone capture.

#### Scenario: User speaks during a reply
- **WHEN** the user starts speaking while Producer replies
- **THEN** the old reply stops and the new turn is received without a manual interrupt action
- **AND** hang-up remains available in both the sidebar and floating voice controls

### Requirement: Contextual opening greeting
Realtime Producer SHALL greet once after microphone permission and audio setup succeed. With meaningful conversation history it SHALL reconnect to the recent creative topic and invite a next step; otherwise it SHALL briefly ask what the user wants to create. Greetings SHALL remain interruptible and SHALL NOT edit the project or fabricate a user transcript.

#### Scenario: Open a conversation with recent musical discussion
- **WHEN** realtime voice starts after discussion of a specific musical idea
- **THEN** Producer opens with a brief greeting grounded in that discussion
- **AND** history stores the assistant opening without a fake user message or duplicate greeting on repeated readiness events

#### Scenario: Start speaking before the opening arrives
- **WHEN** the user speaks before the greeting's audio response arrives
- **THEN** the delayed greeting is discarded and the user's turn takes precedence

### Requirement: Call connection audio feedback
Realtime voice SHALL play a quiet local connection cue after microphone and audio setup succeed, followed by the opening greeting. Ending a connected session SHALL stop capture and reply playback immediately and play a short disconnect cue once. A failed connection SHALL NOT play a successful-connection cue. Cues SHALL remain outside song playback and export.

#### Scenario: Connect and hang up
- **WHEN** voice connects successfully and the user later hangs up
- **THEN** connection and disconnect cues each play once, with the opening scheduled after the connection cue
- **AND** microphone capture stops immediately when hanging up
