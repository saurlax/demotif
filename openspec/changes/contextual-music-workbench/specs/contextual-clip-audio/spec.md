## Purpose

Let users render, reinterpret and analyze Clips or generate at a chosen location through the same contextual Producer and review workflow.

## ADDED Requirements

### Requirement: Contextual Clip actions
Right-clicking an arrangement Clip SHALL select its semantic target, move the floating Producer composer nearby and offer actions appropriate to its source type and available capabilities. Audio Clips SHALL offer audio-to-notes analysis; note and vocal Clips SHALL offer audio rendering and supported AI generation actions.

#### Scenario: Right-clicking a Clip
- **WHEN** a user right-clicks a note Clip
- **THEN** the contextual actions and composer identify that Clip and its actual source range
- **AND** no generation starts merely from opening the menu
- **AND** right-click deletion of individual piano notes remains unchanged

### Requirement: Faithful rendering and AI variation are distinct
Audio rendering SHALL preserve the selected Clip's accepted notes, source window and playback configuration. AI variation SHALL identify its provider and supported guidance, and MUST NOT promise faithful note preservation from a prompt-only model. Both operations SHALL retain the original editable Clip.

#### Scenario: Render an offset Clip
- **WHEN** a user renders an instrumental Clip with a nonzero source offset
- **THEN** the new audio represents its visible source window and playback configuration rather than the complete source
- **AND** the audio is available for audition and explicit placement without deleting the original notes

#### Scenario: Vocal audio is missing
- **WHEN** a vocal Clip is rendered without matching singing assets
- **THEN** the existing score-driven synthesis path prepares matching audio or reports the actual unavailable reason
- **AND** ordinary TTS is not substituted for the scored vocal

### Requirement: Audio-to-notes review
Analysis SHALL accept an owned generated or imported audio Clip, analyze its selected source range and propose an editable note Clip on a muted new track at the captured start beat. The original audio SHALL remain intact. Unsupported ranges SHALL be explained before analysis rather than silently truncated.

#### Scenario: Analyze an imported excerpt
- **WHEN** a user requests notes from an imported audio Clip within analysis limits
- **THEN** analysis uses that Clip's offset and range, converts timing into project beats and offers the result for review
- **AND** accepting creates the note source, library Clip and muted placement atomically

### Requirement: Location-specific generation
An explicit action on empty arrangement space SHALL offer audio generation and anchor the composer to the selected track and snapped beat. A background click SHALL select a location; opening the action menu SHALL NOT send a paid request. Empty-space generation SHALL use the same agent model-selection, task and sidebar approval workflow as Clip actions.

#### Scenario: Generate in empty space
- **WHEN** a user chooses Generate sound at an empty track position and submits the composer
- **THEN** the request captures that track, beat, project version and intended category
- **AND** the reviewed result proposes placement at that location rather than wherever the pointer later moves

### Requirement: Safe result acceptance
Result acceptance MUST validate the captured target, ownership, expected version and current locks. Conflicts or deleted targets SHALL retain generated media and the proposal for recovery without applying a partial conversion or silently overwriting a source. Generated audio SHALL retain its measured duration unless the user explicitly edits it.

#### Scenario: Target changes during generation
- **WHEN** a target is removed or its accepted musical inputs change before result acceptance
- **THEN** the result remains available for audition and the user can explicitly choose a current destination
- **AND** stale conversion commands are not automatically applied or hidden by an animation

### Requirement: Unified Producer conversion tools
Both typed selected-context requests and applicable right-click actions SHALL invoke the same Producer tools. The agent SHALL be able to render notes through a browser-owned tool, analyze audio, generate referenced variations and use other enabled clip-appropriate audio capabilities. Default menu actions SHALL infer a sensible direction from accepted instrument/sample context; typed instructions SHALL support explicit style.

#### Scenario: Render through conversation
- **WHEN** a user selects a note Clip and asks Producer to turn it into Sound
- **THEN** Producer can request its isolated browser rendering, including the accepted instrument and source window
- **AND** the result is staged at the captured position for explicit approval without editing the original Clip

#### Scenario: Style variation with a reference
- **WHEN** the requested style change uses a model supporting audio references
- **THEN** the system captures and validates the owned reference excerpt, uploads it once and passes documented conditioning fields
- **AND** unknown paid outcomes are not retried or silently converted to text-only guidance

#### Scenario: Audio menu applicability
- **WHEN** an audio Clip context menu opens
- **THEN** it offers conversion to notes, stylistic variation, voice conversion, speech cleanup, speech transcription and text alignment
- **AND** opening the menu starts no generation, disabled/locked targets cannot submit work and text analysis never creates fake notes

### Requirement: Floating Producer output visibility
The floating composer SHALL show the latest public Producer text or active operation progress while work is running, update as streamed output arrives, and retain the final reply after completion. The output area SHALL have bounded height, readable wrapping and scrolling, without requiring the history sidebar to open.

#### Scenario: Producer replies with the sidebar closed
- **WHEN** a user submits an instruction from the floating composer
- **THEN** the composer displays working progress followed by streamed Producer text
- **AND** the latest content stays visible as it arrives, while input and stop controls remain available
- **AND** the final reply remains available after the run finishes
