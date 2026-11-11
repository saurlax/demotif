## Purpose

Let users render editable Japanese vocal scores with an installed Japanese singer while preserving the existing job, timing, draft and playback guarantees.

## ADDED Requirements

### Requirement: Report usable Japanese voice readiness
The system SHALL report a Japanese voice ready only when its required model, pronunciation resources, compatible runtime and configured vocoder are available. Unsupported languages and controls SHALL remain identifiable.

#### Scenario: Placeholder voice reference
- **WHEN** a score references a voice that has not been installed
- **THEN** synthesis identifies the unavailable voice and does not report a successful render or change track mute state

#### Scenario: Compatible installed voice
- **WHEN** an installed Japanese voice has verified required components and a successful runtime readiness check
- **THEN** the voice catalog exposes Japanese support and only its supported controls

### Requirement: Preserve Japanese lyrics and scored timing
Japanese synthesis SHALL use the accepted lyrics, pronunciation overrides, note pitches, timing, rests and continuation. Derived phonetic expansion SHALL preserve stored lyric text and note geometry, account for every syllable, and reject ambiguous or invalid assignments with a note-specific error.

#### Scenario: Multiple morae inside one note
- **WHEN** a Japanese lyric assigned to one note expands into multiple morae
- **THEN** those morae fit within that note and its explicit continuation without moving later notes or discarding text

#### Scenario: Pronunciation across note boundaries
- **WHEN** adjacent notes contain fragments of a Japanese word and short articulation gaps
- **THEN** pronunciation uses the relevant complete lyric context before audio segmentation

#### Scenario: Explicit reading and rest
- **WHEN** a score contains an explicit Japanese reading, sustained continuation and a rest
- **THEN** synthesis respects the override, sustain and silence at the scored positions

### Requirement: Render Japanese singing through existing jobs
Japanese singing SHALL use the existing version-checked immutable score and durable job contract. Engine, model, frontend and pronunciation changes SHALL invalidate incompatible cached results. Cancellation and stale-result rules SHALL apply across singer engines.

#### Scenario: Change voice during inference
- **WHEN** a user selects another voice after a Japanese render starts
- **THEN** late audio from the previous voice is not presented as current

#### Scenario: Unsupported expression
- **WHEN** the selected Japanese voice cannot render a requested expression control
- **THEN** the system explains the unsupported control rather than silently ignoring it in a purported complete render

### Requirement: Audition and export real Japanese vocal audio
A successful Japanese render SHALL contain score-driven sung audio with the selected singer, aligned for single-clip audition, arrangement playback and export. Speech synthesis, synthetic guide tones and missing phrases SHALL NOT be represented as a successful singing result.

#### Scenario: Ready single vocal clip
- **WHEN** a Japanese clip finishes rendering its accepted score
- **THEN** its single-clip audition and exported placement use the same aligned vocal performance

### Requirement: Repair voice selection through explicit edits
Changing an existing score from an unavailable voice to an installed Japanese singer SHALL use versioned validated edits. The change SHALL preserve locks, lyrics, notes, unrelated tracks, undo and independent-draft isolation. Render completion SHALL NOT save the project implicitly.

#### Scenario: Repair the selected draft
- **WHEN** the selected editable draft receives an accepted Japanese voice change
- **THEN** that draft can render the voice without rewriting other independent drafts or implicitly saving the base project
