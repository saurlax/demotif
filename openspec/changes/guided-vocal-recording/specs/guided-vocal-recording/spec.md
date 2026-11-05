## Purpose

Enable performers to record real singing references against accepted vocal-score lyric cues, review and repeat takes, and preserve selected audio with timing context for later analysis.

## ADDED Requirements

### Requirement: Vocal-score recording entry and cues
The studio SHALL offer Record reference inside a vocal editor. The recording dialog SHALL show the source name, readable lyrics, musical cue locations, current and upcoming text, elapsed time, and playback/recording progress. Cues SHALL use the accepted source score and tempo without modifying it. Multiple syllables within a note SHALL use authored durations where unambiguous, otherwise estimated within-note positions visibly distinguished from measured alignment. Continuations SHALL extend the previous final syllable without repeating its text. The full vocal source SHALL be the recorded range, including when opened from a trimmed placement.

#### Scenario: Multi-syllable note and continuation
- **WHEN** a source contains grouped lyrics and a following continuation note
- **THEN** the dialog preserves the lyric grouping, extends the last syllable across the continuation, and does not invent precise measured timings for unaligned syllables

#### Scenario: Current and next phrase
- **WHEN** recording advances across a cue boundary
- **THEN** the active word and progress advance from the same recording clock while upcoming words remain visible without layout jumps

### Requirement: Local count-in and clean capture
The performer SHALL explicitly grant microphone access and SHALL be able to choose an available microphone and inspect actual input level before starting. Record SHALL provide a one-bar count-in using the source meter and tempo. An optional audible count-in SHALL be off by default; headphones advice SHALL appear when enabled. Capture SHALL start against a browser audio clock after preparation, independent of server or synthesis availability. Only microphone audio SHALL enter the take; count-in and synthetic vocals SHALL NOT be mixed into its capture graph. The default SHALL have no microphone monitoring and request disabling automatic gain, noise suppression and echo cancellation when supported, without rejecting devices that ignore those requests.

#### Scenario: Permission denied
- **WHEN** microphone permission is denied or no microphone is available
- **THEN** a top-center error toast explains the actionable failure, recording does not start, and retry remains available

#### Scenario: Unavailable singing synthesis
- **WHEN** a vocal source has no rendered synthesis and the user starts recording
- **THEN** prepared local recording and visual cues work without a synthesis or agent request

#### Scenario: Compound meter count-in
- **WHEN** a 6/8 source starts a take
- **THEN** one count-in bar lasts three quarter-note beats, matching the source tempo convention and six eighth-note subdivisions

### Requirement: Take review and re-record
Stop SHALL finish the current take and automatic completion SHALL occur at the source range end with a short defined release tail. A completed take SHALL support play/pause, seeking with lyric progress, WAV download, Save reference and Re-record. Re-record SHALL retain the previous completed take until the replacement finishes successfully; cancellation or capture failure SHALL keep the previous take available. Captured audio SHALL remain local until Save reference. A zero-frame or interrupted capture SHALL NOT replace a usable take.

#### Scenario: Replacement fails
- **WHEN** the microphone disconnects during a re-record
- **THEN** capture ends safely, a top-center toast reports the interruption, and the preceding completed take remains available

#### Scenario: Review follows audio
- **WHEN** the performer seeks while auditioning a take
- **THEN** displayed progress and lyric highlighting follow the take playback position rather than the elapsed wall clock

### Requirement: Explicit reference persistence
Save reference SHALL upload the take as reference media and atomically add an audio source, library entry and a muted reference-track placement through expected-version commands. It SHALL retain the synthesized vocal source and placements. The new audio source SHALL carry a typed recording snapshot containing source identity, source/version context, cue timing and lyrics, tempo/meter, sample rate and capture origin. Uploaded media alone SHALL NOT be presented as an accepted project edit. Saving a reference SHALL dirty the editing draft; normal project Save/Save as semantics SHALL remain unchanged. Save conflicts and failures SHALL retain the take and its download/retry actions.

#### Scenario: Save and reload
- **WHEN** a user saves a reference take and subsequently saves and reloads the project
- **THEN** its audio, muted placement, original cue snapshot and original synthesized score remain available

#### Scenario: Accepted upload and rejected command
- **WHEN** upload succeeds but the versioned placement command conflicts or fails
- **THEN** the dialog keeps the take unsaved and reports the error without claiming that a reference was added or issuing duplicate accepted placements on retry

### Requirement: Recording lifecycle and departure protection
Recording SHALL own local audio interaction while active; conflicting arrangement playback and clip audition SHALL stop before count-in. Closing, navigating, refreshing or closing the tab with an active recording or unsaved completed take SHALL use the shared departure protection. An explicit discard SHALL release resources. Ordinary unmount, microphone loss and cancellation SHALL stop capture, count-in, playback, microphone tracks, worklet processing and progress callbacks. A permission request that resolves after dismissal SHALL release the returned stream. Hiding the document during capture SHALL stop and retain captured audio as an interrupted take when usable. Source/tempo edits SHALL be unavailable during a take; an accepted external project change SHALL stop capture and preserve its original cue snapshot.

#### Scenario: Cancel departure
- **WHEN** the user attempts to leave with an unsaved take and cancels the shared confirmation
- **THEN** the workspace and take remain available with no stacked confirmation

#### Scenario: Late microphone grant
- **WHEN** permission resolves after the recording dialog has been dismissed
- **THEN** all acquired microphone tracks are stopped and recording does not restart

### Requirement: Accessible recording controls
The dialog SHALL use the existing cool blue/mint theme and shared dialog/button components, with primary text at least 14px, secondary timing at least 12px and icon hit targets at least 32px. Controls SHALL wrap or scroll at narrow widths. Keyboard activation SHALL work; progress animation SHALL honor reduced motion and avoid repeated screen-reader announcements for every animation frame. Errors SHALL use shared top-center toasts with accessible field reasons where needed.

#### Scenario: Narrow viewport and keyboard review
- **WHEN** a keyboard user records and reviews a long lyric source on a narrow viewport
- **THEN** recording, stop, retry, download and save controls remain reachable, text remains readable and focus returns to the invoking control on closure
