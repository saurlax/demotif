## Purpose

Provide optional, music-sensitive studio background atmospheres and rhythmic visuals while preserving the shared UI, reliable editing, accessible reading, and real-time audio performance.

## ADDED Requirements

### Requirement: Adaptive effects are confined to open projects
The system SHALL restrict adaptive background effects to the open studio. Home and global library pages SHALL retain the restrained shared design system without genre-dependent shaders or beat motion.

#### Scenario: Return to the project list
- **WHEN** the user leaves a studio with an active atmosphere
- **THEN** its visual rendering resources are released and the project list displays the normal shared UI

### Requirement: Users control atmosphere and motion
The system SHALL offer Auto, Neutral, Classical, Electronic, and Off, plus a motion-intensity control, in compact studio settings. A manual selection SHALL override automatic analysis and remain associated with that project's visual preferences without editing musical data.

#### Scenario: Manual override
- **WHEN** the user chooses Classical after an Electronic analysis result
- **THEN** Classical remains active until the user changes the preference, and no musical revision is created

#### Scenario: Effects disabled
- **WHEN** the user chooses Off
- **THEN** the studio retains its shared UI with no atmosphere animation or background shader work

### Requirement: Automatic adaptation exposes evidence and uncertainty
The system SHALL apply an automatic genre-derived profile only from a matching analysis result with confidence at least 0.75. It SHALL distinguish arrangement inference from measured audio-feature evidence. Tempo alone, silence, missing analysis, or ambiguous evidence SHALL NOT be presented as a reliable genre detection.

#### Scenario: Insufficient evidence
- **WHEN** an audio-only project has no usable analysis or the result confidence is below 0.75
- **THEN** Auto uses Neutral, explains the uncertainty concisely, and leaves manual selection available

#### Scenario: Stale result
- **WHEN** analysis completes for a project version or audio-feature identity that is no longer current
- **THEN** that result does not change the current atmosphere

### Requirement: Background profiles reflect musical character without moving controls
The system SHALL provide a restrained warm Classical treatment and a richer spatial Electronic treatment. Profile changes SHALL affect only backgrounds and limited lighting/accent treatment; they SHALL NOT reposition clips, notes, controls, labels, or panel boundaries.

#### Scenario: Electronic profile while editing
- **WHEN** the Electronic background is active while a user drags a clip or edits a note
- **THEN** the pointer gesture and snap geometry remain unchanged and the background intercepts no input

### Requirement: Motion follows actual playback
The system SHALL derive rhythmic phase from the actual audio playback position, including clip loops, seeking and scheduled starts. Energy-driven effects SHALL use actual audible audio rather than random animation or fabricated meters, and silence SHALL produce no energetic response.

#### Scenario: Seek or loop
- **WHEN** the user seeks during playback or playback wraps at a loop boundary
- **THEN** the visual beat phase aligns with the new audio position without continuing an unrelated wall-clock animation

#### Scenario: All audible tracks muted
- **WHEN** the audible master output becomes silent
- **THEN** audio-energy effects settle to their quiet baseline instead of showing fabricated activity

### Requirement: Visual processing cannot gate or alter audio
The system SHALL preserve playback, recording-start independence, routing, locks, versioned edits, undo and export behavior when analysis or visual rendering is slow, fails or is disabled. Atmosphere changes SHALL NOT alter the exported sound or musical document.

#### Scenario: Analysis unavailable during playback
- **WHEN** analysis fails or stalls while music is playing
- **THEN** audio continues independently and the UI retains a usable static or manual atmosphere

### Requirement: Accessibility and reading clarity take precedence
The system SHALL honor reduced-motion preferences, maintain readable foreground contrast, preserve focus visibility and minimum text sizes, and avoid strobing. The user SHALL be able to disable motion without disabling editing or playback.

#### Scenario: Reduced motion enabled
- **WHEN** the OS reduced-motion preference is active
- **THEN** the studio uses a static profile and does not start beat-driven or continuously animated background effects

### Requirement: Rendering is bounded and has a static fallback
The system SHALL bound visual frame work, suspend it when playback is paused or the document is hidden, and release it on departure. Unsupported graphics capabilities or context loss SHALL fall back to a static background without a blocking error or loss of editing access.

#### Scenario: Graphics unavailable
- **WHEN** the device cannot provide the graphics context or loses it
- **THEN** the studio remains editable with the shared static theme and normal audio operation

### Requirement: Remote analysis is explicit and credentials remain server-side
The system SHALL perform remote analysis only after an explicit Analyze action, use aggregate feature and arrangement data, allow at most one in-flight analysis per project, and reuse matching cached results. It SHALL NOT upload raw audio, expose credentials to the browser, automatically retry paid requests, or generate audio as a side effect of atmosphere selection.

#### Scenario: Missing service or credentials
- **WHEN** the configured analysis service is unavailable
- **THEN** Auto remains Neutral with a truthful status and manual profiles continue to work locally

#### Scenario: Repeated request
- **WHEN** the user requests analysis while a matching request is in flight or already cached
- **THEN** the existing request or matching cached result is reused without another provider charge
