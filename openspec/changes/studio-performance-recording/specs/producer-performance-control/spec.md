# Spec Delta

## Purpose

Let Producer coordinate browser performance controls through acknowledged, version-aware requests while the browser retains authority over audio timing and microphone access.

## ADDED Requirements

### Requirement: Fully specified conversational recording
The Producer recording tool SHALL require the segment to record, destination track, start beat, end beat, count-in, accompaniment and follow-up intent. Producer SHALL resolve missing choices in conversation before recording and SHALL NOT invent unresolved timing or destinations. Capture SHALL stop at the requested browser-clock frame without a subsequent user click. General transport control SHALL NOT bypass required recording parameters.

#### Scenario: User asks to hum without a range
- **WHEN** the intended segment, destination or recording range is unresolved
- **THEN** Producer asks for the missing decision and no recording is armed
- **AND** once resolved, microphone permission and preparation speech are the only remaining readiness gates

### Requirement: Verified recording continuation
Browser recording completion SHALL provide Producer a server-verified owned Clip and fresh project context. Duplicate notifications SHALL NOT repeat continuation or analysis. Failed/interrupted captures SHALL retain recovery material and SHALL NOT be reported as accepted content before placement succeeds. Dry humming SHALL exclude accompaniment.

#### Scenario: Hum and continue composing
- **WHEN** a fully specified humming recording ends and its placement is accepted
- **THEN** the existing conversation continues from the new Clip and the requested follow-up can use existing audio-to-notes/edit tools
- **AND** singing is not submitted as a chat transcript

### Requirement: Acknowledged file tools
Producer SHALL expose explicit Save/Save as and WAV export through owning-browser requests, preserving normal draft version checks and actual completion acknowledgement.

#### Scenario: Save as followed by export
- **WHEN** the user asks Producer to save the draft under a specified name and export its audio
- **THEN** the owning browser completes Save as through the existing file workflow and acknowledges the new accepted version
- **AND** export uses that version, waits for actual completion, and does not bypass validation or apply staged musical edits

### Requirement: Acknowledged performance control
Producer SHALL request metronome, playback, recording preparation and stop actions through validated browser-control messages. Requests SHALL target the initiating project and browser, capture the accepted project version and report actual execution or unavailable state. They SHALL NOT modify musical content through an unvalidated side channel.

#### Scenario: Ask Producer to enable the metronome
- **WHEN** the user asks Producer for a metronome in the active studio
- **THEN** the browser enables its real metronome and returns an acknowledgement before Producer claims success
- **AND** a disconnected or unsupported browser returns an actionable failure

### Requirement: Local recording readiness
Producer-assisted recording SHALL wait for asset preparation, microphone permission and browser audio readiness. Once ready, local scheduling SHALL determine count-in and capture timing. Any spoken preparation reply SHALL finish before count-in starts. Recording start SHALL remain cancellable before onset.

#### Scenario: Spoken four-beat request
- **WHEN** the user asks to sing after four clicks
- **THEN** the browser prepares the recording and schedules count-in after any preparation reply has finished playing
- **AND** missing permission or blocked audio readiness prevents recording and presents the necessary local action

### Requirement: Idempotent ownership and cancellation
Each control request SHALL execute at most once, remain owned by the initiating browser and expire or cancel with its Producer run. Reconnect and history replay SHALL NOT start transport or microphone capture. A stale project version SHALL reject new performance preparation without rebasing silently.

#### Scenario: Duplicate event or second browser
- **WHEN** a request is delivered twice or seen in another tab
- **THEN** only the owning browser executes it once and historical events never start a new performance

### Requirement: Safe boundaries for runtime controls
Metronome and transport state SHALL remain browser session state. Completed recordings SHALL enter the project as ordinary audio Clips through normal versioned commands with locks, Undo and explicit Save semantics. Control acknowledgements SHALL distinguish preparation, scheduled onset, active capture and accepted content.

#### Scenario: Recording finishes but placement conflicts
- **WHEN** capture succeeds but the draft changed before placement
- **THEN** Producer reports the placement conflict while the captured take remains available
- **AND** it does not claim that the project contains the take until the server accepts it
