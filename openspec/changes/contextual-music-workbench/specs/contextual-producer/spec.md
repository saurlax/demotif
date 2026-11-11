## Purpose

Keep Producer accessible within the musical workspace and make its real target and operation state visible without requiring an open conversation sidebar.

## ADDED Requirements

### Requirement: Floating composer and optional conversation
Inside an open project, Producer SHALL default to a compact floating input with the conversation sidebar closed. Opening or closing the sidebar SHALL preserve the input draft, conversation, active run, cancellation and review actions. Studio content SHALL regain the sidebar's width when it closes.

#### Scenario: Continue a run with the sidebar closed
- **WHEN** a user submits a request and closes its conversation sidebar
- **THEN** the floating composer remains a shortcut input with a send/stop control, real progress uses the contextual cursor, and full conversation and result review remain in the sidebar
- **AND** reopening the sidebar shows the same run without duplicate submission or event subscriptions

### Requirement: Semantic context and stable placement
The composer SHALL carry the selected Clip, source, note IDs or empty musical location as validated context and move near an explicitly chosen context target. Target identity SHALL survive scrolling, zooming and panel changes; presentation coordinates SHALL remain within the usable viewport. Moving the composer SHALL preserve typed input and keyboard focus.

#### Scenario: Right-click a different Clip
- **WHEN** a user right-clicks another Clip while a prompt is being composed
- **THEN** the composer relocates near it, exposes the new target and retains the text
- **AND** an already submitted run continues using its own immutable captured target

### Requirement: Truthful Producer cursor
Producer SHALL display a distinct non-interactive cursor or target marker for actual targeted inspection, generation, proposed edits and application. Concise streaming text SHALL distinguish working, proposed, applying, applied, cancelled and failed states. Events MUST refer to validated project entities or captured musical ranges rather than fabricated pointer coordinates.

#### Scenario: Proposed edits await approval
- **WHEN** Producer proposes edits to a Clip
- **THEN** its cursor can move to the target and show the proposed operation
- **AND** previews remain visually distinct while accepted notes and Clip geometry remain unchanged until approval

#### Scenario: Several targets in one accepted batch
- **WHEN** one approved atomic batch edits several visible targets
- **THEN** feedback can move among those actual targets while identifying the batch as applied
- **AND** it does not imply independently accepted intermediate versions or delay the atomic server commit

#### Scenario: Target is offscreen or missing
- **WHEN** a run targets an offscreen or deleted entity
- **THEN** a concise target status is shown without animating at stale coordinates or forcing playback-follow scrolling

### Requirement: Accessible motion and controls
Composer and cursor motion SHALL preserve musical editing geometry, avoid intercepting note/Clip gestures and honor reduced motion. Input and review controls SHALL remain readable, keyboard accessible and usable at narrow widths; essential status SHALL be available without animation.

#### Scenario: Narrow viewport and reduced motion
- **WHEN** reduced motion is enabled in a narrow studio
- **THEN** context and operation status remain visible without travel animation, horizontal overflow or controls covering the selected edit target
- **AND** Escape closes a contextual popup and returns focus without cancelling unrelated musical edits

### Requirement: Run lifecycle and unsaved protection
Pending Producer work and uncommitted composer text SHALL participate in existing departure protection. Changing project SHALL clear project-specific targets and subscriptions without mixing conversations. Errors SHALL use shared deduplicated toasts and retain recoverable input.

#### Scenario: Leave during generation
- **WHEN** a user attempts internal navigation during pending generation or with an uncommitted prompt
- **THEN** the existing shared departure dialog handles the decision once
- **AND** cancelling departure retains the composer, target and run state

### Requirement: Input-only floating shortcut
The floating composer SHALL contain only an auto-growing text input and a send/stop control, with a compact default width and vertically aligned controls. It SHALL NOT expose model/category selectors, generation settings, review dialogs or conversation output. Producer SHALL infer intent and choose a ready tool/model; conversation and result acceptance SHALL remain in the sidebar.

#### Scenario: Submit a contextual message
- **WHEN** a user selects notes or a Clip and submits a natural-language instruction
- **THEN** the message carries an immutable validated selection snapshot without requiring model selection
- **AND** reopening the sidebar shows the same request, its references and reviewable results

### Requirement: Sidebar Producer model choice
The sidebar SHALL offer Producer model selection with DeepSeek Flash as the single default preset. The floating input SHALL remain model-picker free. Each submitted run SHALL capture and validate the selected model without changing an existing run; audio model selection SHALL remain agent-driven.

#### Scenario: Default model
- **WHEN** a project opens with the shared model credential configured
- **THEN** DeepSeek Flash is selected by default and the sidebar offers its model selector
- **AND** unsupported model IDs are rejected before starting a run

### Requirement: Voice entry and configured conversation transport
An idle empty composer SHALL show a microphone action instead of a disabled send button. Nonempty text SHALL show send; running work SHALL show stop. With StepFun configured, voice chat SHALL use continuous StepAudio Realtime speech with interruption and delegate musical edits to the existing Producer. Without StepFun, voice chat SHALL retain direct ElevenLabs transcription, the selected Producer model and spoken replies. Both paths SHALL preserve conversation history and captured selection.

#### Scenario: Enter voice chat
- **WHEN** a user clicks the microphone with an empty input
- **THEN** microphone access is requested and actual states of the configured voice transport are shown
- **AND** silence after speech completes a turn and replies are spoken; realtime capture continues through assistant speech and supports interruption

#### Scenario: Cancel voice capture
- **WHEN** voice chat ends, the project changes, the document becomes hidden or capture fails
- **THEN** microphone tracks, recorder, analyser, pending speech/transcription requests and playback are stopped
- **AND** existing conversation and pending edit approval remain available

#### Scenario: Voice request uses a captured selection
- **WHEN** a spoken turn begins while notes or a Clip are selected
- **THEN** the turn captures that accepted version and selection
- **AND** a conflicting edit retains the transcript for review rather than silently rebasing the instruction

### Requirement: Automatic reversible Producer edits
New Producer runs SHALL commit their completed validated command batch automatically to the current draft with the captured expected version. This replaces explicit review/Apply requirements for new runs. Historical unapplied runs SHALL NOT replay on page load. Applying SHALL preserve locks and version checks and create one normal undoable operation without saving the project.

#### Scenario: A run finishes with edits
- **WHEN** a new run completes with valid edits and its accepted version is current
- **THEN** its batch is applied once, the browser refreshes the project, and the conversation offers Undo changes
- **AND** Ctrl+Z reverses the operation through normal history

#### Scenario: Concurrent editing changes the version
- **WHEN** the draft version changed during generation
- **THEN** automatic application fails without overwriting current content, retains the generated result, and reports a toast

### Requirement: Compact Producer conversation controls
Model selection SHALL appear at the lower-right of the message input. Voice-chat entry SHALL use a waveform icon in both composers. Assistant output SHALL render Markdown directly without a bubble. The sidebar SHALL omit the independent Audio results section and Apply controls.

#### Scenario: Sidebar conversation
- **WHEN** a user opens Producer history
- **THEN** Markdown paragraphs and lists render directly, the input contains the model selector, and applied changes expose Undo instead of Apply
