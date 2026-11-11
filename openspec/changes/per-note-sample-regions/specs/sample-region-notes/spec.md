## ADDED Requirements
### Requirement: Per-note sample mapping
A note MAY reference an optional source window with nonnegative offset, positive duration in seconds and MIDI rootNote. Such notes SHALL require a note or drum source with a sampler and an owned asset. Destination time and source-window units SHALL remain distinct.
#### Scenario: Move or transpose a region note
- **WHEN** a mapped note is moved or transposed
- **THEN** its source window remains unchanged and pitch is relative to its captured root
### Requirement: Bounded browser rendering
The browser sampler SHALL read only the clamped mapped region and SHALL stop at its end. Legacy sampler behavior SHALL remain compatible. Playback and export SHALL use the same mapping, including stereo.
#### Scenario: A region ends before the note
- **WHEN** a note duration exceeds its captured window
- **THEN** playback stops at the region boundary without playing adjacent material
### Requirement: Editable source windows
Mapped notes SHALL expose sample start, sample length and sample root controls in the existing note dialog using normal validated commands and undo.
#### Scenario: Change a note window
- **WHEN** the user commits a new sample start
- **THEN** the accepted note mapping updates once without moving other notes
