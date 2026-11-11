## Purpose

Generate musical ideas as editable notes in the Producer's current project draft.

## ADDED Requirements

### Requirement: Import a generated lead sheet

When configured, Producer SHALL generate YuE2 score plans on request and stage validated notes at the requested beat in one undoable batch.

#### Scenario: Import a complete score

- **WHEN** YuE2 returns a valid complete plan
- **THEN** Producer stages the available melody voices as note Clips and reports the source tempo, meter and chord symbols

#### Scenario: Preserve the native score structure

- **WHEN** Producer imports a complete native YuE2 ABC score
- **THEN** the versioned draft retains the original ABC, score placement, source lyrics, bar meters, key changes, section ranges and chord symbols
- **AND** the timeline shows imported chord symbols and sections at the requested beat while existing arrangement settings and overlapping section labels are preserved

#### Scenario: Place reusable melody Clips

- **WHEN** a native score contains repeated measures
- **THEN** exact matches within each voice share a source and the placements preserve the original beats
- **AND** notes spanning barlines remain intact

#### Scenario: Compose a new arrangement

- **WHEN** the user requests new musical material or substantial arrangement changes
- **THEN** Producer uses YuE2 Render by default and stages its stereo mix and original ABC-based editable notes in one undoable batch
- **AND** an explicit Plan-only request uses score planning, and targeted corrections use direct project edits

#### Scenario: Reject an unusable score

- **WHEN** generation fails, is cancelled, or returns an invalid or truncated plan
- **THEN** the generation stages no project edits

#### Scenario: Recover a transient result retrieval failure

- **WHEN** a submitted Modal score call temporarily cannot be read
- **THEN** Producer retries reading the same call within the run deadline and stages the validated result once it is available

### Requirement: Render a full YuE2 song

When YuE2 is configured and the user requests a full song render, Producer SHALL use the style, lyrics, and seed to stage the validated stereo mix as an audio Clip in one undoable batch.

#### Scenario: Import a rendered mix

- **WHEN** the YuE2 worker returns valid FLAC audio
- **THEN** Producer adds an audio track containing the mix and reports any generation truncation
