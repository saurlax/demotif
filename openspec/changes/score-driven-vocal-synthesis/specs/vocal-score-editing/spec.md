## Purpose

Enable users and the Producer to author editable singing performances from monophonic notes, lyrics and expression while preserving existing project editing, save and undo behavior.

## ADDED Requirements

### Requirement: Create a vocal source from an installed voice
The system SHALL support vocal sources with a selected installed voice, supported language, notes and editable lyrics. Creating a vocal clip SHALL use the existing explicit clip-creation workflow. Existing instrumental, drum and audio sources SHALL retain their behavior.

#### Scenario: Create a vocal clip
- **WHEN** a user selects Vocal in the clip-creation dialog and chooses a ready voice and supported language
- **THEN** the created clip opens in the shared piano-roll editor with editable vocal notes and lyrics

#### Scenario: Singing is not installed
- **WHEN** no voice profile is ready
- **THEN** vocal creation explains the missing installation without preventing ordinary project editing or playback

### Requirement: Preserve syllable assignments and monophonic timing
A vocal source SHALL associate lyric syllables or explicit syllable continuations with stable note identities. Vocal notes SHALL be monophonic, and rests SHALL preserve their scored gaps. The system SHALL reject overlapping vocal notes or invalid continuation references with an actionable error rather than silently removing or changing notes. Instrument sources SHALL continue to allow polyphony.

#### Scenario: Sustain one syllable across notes
- **WHEN** a user assigns a syllable to one note and continuation to the following note
- **THEN** the score preserves one syllable over the combined group while retaining both pitches

#### Scenario: Invalid overlap
- **WHEN** an edit would overlap two notes in the same vocal source
- **THEN** the edit is rejected with the affected notes identified and the accepted score remains intact

#### Scenario: Empty lyrics remain editable
- **WHEN** a user saves a vocal score with unassigned lyrics
- **THEN** the score remains editable and saveable, while synthesis reports the unassigned notes

### Requirement: Editable pronunciation and performance controls
The system SHALL preserve explicit pronunciation and phoneme-timing overrides separately from lyric text. It SHALL support editable pitch offsets, vibrato and volume with defined musical units. User pitch overrides SHALL remain distinct from predicted pitch and SHALL take precedence in their specified regions. Controls that a selected voice cannot implement SHALL be unavailable with a reason rather than pretending to affect sound.

#### Scenario: Correct a pronunciation
- **WHEN** a user overrides a note group's pronunciation without changing its displayed lyric
- **THEN** subsequent synthesis uses the override and save/reopen preserves both values

#### Scenario: Change voice after editing pitch
- **WHEN** a user selects another compatible voice after drawing a manual pitch curve
- **THEN** the editable curve is retained and reapplied to the new performance rather than replaced by predicted pitch

### Requirement: Versioned reversible vocal edits
All vocal score, lyric, voice and expression mutations SHALL use the project's typed versioned editing path. They SHALL preserve shared-source locks, append-only undo, isolated drafts and explicit Save/Save as. Model rendering SHALL NOT silently replace the editable score or mark a saved score dirty solely because derived audio finished.

#### Scenario: Locked shared source
- **WHEN** a vocal source is referenced by a locked clip or track and an edit targets that source
- **THEN** the edit is rejected under the existing lock rules

#### Scenario: Undo and save
- **WHEN** a user edits lyrics, undoes the edit and saves or saves as a new project
- **THEN** the accepted lyrics, notes and expression match the undone state in the resulting saved project

#### Scenario: Producer edits use the same contract
- **WHEN** the Producer proposes changing vocal lyrics or pitch
- **THEN** the proposed commands use the same validation, approval/application and version checks as direct editing

### Requirement: Reuse accessible compact editing surfaces
Vocal editing SHALL use the existing musical editing workspace. Note-specific lyric/pronunciation and parameter controls SHALL open in a centered modal dialog for the selected note; phrase-level lyric assignment and voice configuration SHALL use explicit dialogs. Optional expression lanes SHALL be collapsible. Editing SHALL preserve readable label sizes, keyboard focus, text selection inside inputs and existing pointer/animation/reduced-motion behavior.

#### Scenario: Open and dismiss a lyric editor
- **WHEN** a user activates a vocal note and then cancels its lyric editor with Escape
- **THEN** focus returns to the relevant editing control without altering the note, dismissing the whole clip editor or leaving a parameter sidebar occupying the arrangement

#### Scenario: Narrow viewport
- **WHEN** vocal controls are used at a narrow viewport
- **THEN** controls remain reachable through wrapping, scoped scrolling or dialogs without shrinking labels below the existing interface minimums

### Requirement: Backward-compatible project loading
Projects without vocal metadata SHALL load with their existing content and audio behavior unchanged. Save, Save as and reopen SHALL retain vocal score data even when its voice is temporarily unavailable; unavailable rendering SHALL be reported without deleting the score.

#### Scenario: Missing voice on reopen
- **WHEN** a saved vocal project is opened on an installation without its voice
- **THEN** notes, lyrics and curves remain editable and the missing voice is identified

### Requirement: Phrase entry inside the selected note
The note editor SHALL place all entered syllables inside the selected note by default without a placement-mode selector or a requirement for following notes. It SHALL preserve the note geometry, untouched notes and pronunciation overrides on untouched assignments. An explicit Split action SHALL divide only the selected note into equal adjacent notes and assign the phrase atomically.

#### Scenario: Phrase on the last note
- **WHEN** a user enters multiple syllables on the last note and applies lyrics
- **THEN** the selected note contains the full phrase, its timing is unchanged and no overflow warning is shown

#### Scenario: Explicit split
- **WHEN** a user chooses Split into N notes
- **THEN** only the selected note is divided into N equal adjacent notes with the entered syllables, preserving the original time window

### Requirement: Multiple syllables within one note
The source SHALL support multiple syllables within one note, including assignments without explicit mode metadata. It SHALL preserve displayed text, pronunciation overrides, manual expression and continuation semantics through save and undo.

#### Scenario: One pitch and multiple syllables
- **WHEN** a note contains a phrase
- **THEN** the compiler allocates its time across the phrase's syllables rather than looking up the entire phrase as one dictionary syllable

#### Scenario: Continuation after a multiple assignment
- **WHEN** continuation notes follow a multiple-syllable note
- **THEN** they sustain its final syllable, with the earlier syllables contained in the initial note

### Requirement: Consistent note deletion and duration controls
Piano and drum editors SHALL delete notes or hits on right-click and SHALL NOT delete them on left-click or double-click. Duration edits SHALL align to the editor grid and display at most two decimal places without modifying imported timing merely on opening an inspector.

#### Scenario: Delete a vocal note
- **WHEN** a user right-clicks an unlocked vocal note
- **THEN** it is deleted with its lyric and vibrato references, and orphan continuation assignments are cleared without removing other notes

#### Scenario: Inspect fractional timing
- **WHEN** a user opens an imported note with a fractional duration
- **THEN** its readable duration is rounded to at most two decimals and its accepted timing remains unchanged until edited
