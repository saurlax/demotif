# Spec Delta

## Purpose

Support browser-local musical preparation and real vocal performance with a consistent beat, synchronized accompaniment and reusable audio Clips recorded directly onto tracks.

## ADDED Requirements

### Requirement: Workbench metronome
The studio SHALL provide an accessible metronome toggle beside transport controls. Clicks SHALL follow accepted project tempo and meter, accent bar starts, and align with playback when transport runs. A metronome enabled while stopped SHALL support independent practice. Clicks SHALL remain outside recorded PCM and exported song audio.

#### Scenario: Seek or stop playback with metronome enabled
- **WHEN** the user seeks or stops while the metronome is enabled
- **THEN** queued clicks for the old position stop and any continuing practice clicks use a consistent local beat phase
- **AND** disabling the metronome cancels all pending clicks immediately

#### Scenario: Pause or stop
- **WHEN** the user pauses or stops transport
- **THEN** queued clicks stop with playback
- **AND** pause retains metronome enablement for resume, while Stop disables it

#### Scenario: Start playback while practicing
- **WHEN** the metronome is already ticking and the user starts playback
- **THEN** playback waits for alignment with the existing pulse grid instead of resetting its phase
- **AND** a mid-beat song position retains its offset while subsequent song beats align with clicks

#### Scenario: Enable metronome during playback
- **WHEN** the user enables the metronome while the song plays
- **THEN** clicks join at the next song pulse rather than sound immediately on button activation

### Requirement: Synchronized count-in
Performance recording SHALL offer no count-in, exactly four quarter-note clicks, or one bar of meter pulses. After required assets and microphone are ready, the browser SHALL schedule preparatory clicks, accompaniment onset and capture onset against one audio clock. Accompaniment SHALL remain silent during count-in. Network timing SHALL NOT schedule individual beats.

#### Scenario: Four clicks before singing
- **WHEN** the user starts an armed four-click recording at the current project position
- **THEN** exactly four quarter-note clicks precede simultaneous accompaniment and microphone capture onset
- **AND** recorded PCM excludes the preparatory count-in

### Requirement: Record directly into reusable audio Clips
General microphone recording SHALL be available without a synthesized vocal source. Stopping a nonempty recording SHALL automatically upload and place it as an ordinary audio Clip on a new audio track at its captured musical origin. Placement SHALL use one validated undoable draft operation without saving the project implicitly or requiring a separate keep-take action.

#### Scenario: Complete a recording
- **WHEN** the user finishes a recording and placement succeeds
- **THEN** its real waveform appears in the arrangement as an ordinary editable audio Clip
- **AND** existing track and Clip controls provide playback, mute/solo, moving, trimming, splitting and reuse

### Requirement: Re-record without replacing prior recordings
Re-recording SHALL create another ordinary audio Clip and track without replacing or silently muting earlier recordings. Users SHALL manage any number of completed recordings through existing arrangement and track controls. The system SHALL NOT add a dedicated A/B, take-list or chosen-take interface. Pending unsaved PCM and uploads SHALL participate in departure protection.

#### Scenario: Record the same phrase again
- **WHEN** the user records a second performance of the same phrase
- **THEN** the second recording is added independently at its captured origin and the first remains unchanged
- **AND** the user can compare them using existing playback and mute/solo controls

### Requirement: Interrupted capture and version safety
Stop, cancellation, microphone loss, hidden document or project departure SHALL cancel pending count-in and accompaniment work and release capture resources. Captured material SHALL retain its original origin and timing. Stale draft versions SHALL prevent automatic placement while keeping recoverable takes available.

#### Scenario: Cancel during count-in
- **WHEN** the user cancels before capture onset
- **THEN** queued clicks and accompaniment are stopped, microphone capture ends, and no empty take is inserted

### Requirement: Conversation and performance microphone ownership
During performance count-in and capture, realtime conversation uplink and spoken replies SHALL be held so singing is not submitted as chat. Ending capture SHALL restore the existing voice session when still active, without a new greeting or call-connection cue. This SHALL preserve the selected voice and provider-default VAD settings.

#### Scenario: Sing while connected to Producer
- **WHEN** a prepared performance starts during an active voice conversation
- **THEN** singing is captured as the take without interrupting or prompting conversational replies
- **AND** spoken conversation resumes after capture ends
