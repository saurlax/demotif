## Purpose

Allow users to select and transform groups of piano-roll notes without losing musical relationships or accepted project state.

## ADDED Requirements

### Requirement: Marquee selection without accidental creation
Left-dragging empty piano-roll space SHALL select intersecting notes using musical coordinates. An empty-space click without crossing the drag threshold SHALL retain note creation. Shift SHALL add to the current selection; Shift-clicking a note SHALL toggle membership. Selection SHALL remain local editor state.

#### Scenario: Drag across several notes
- **WHEN** a user left-drags a rectangle across multiple notes and releases
- **THEN** intersecting notes are visibly selected and no new note or project command is created
- **AND** scrolling during selection keeps the rectangle aligned with musical coordinates

#### Scenario: Existing single-note editing
- **WHEN** a user clicks one note without modifiers or movement
- **THEN** it becomes the active selection and its existing parameter dialog remains accessible
- **AND** a group move or resize does not open that dialog

### Requirement: Atomic group movement
Dragging a selected note SHALL move the selected group by one shared snapped time delta and integer pitch delta. The whole-group delta SHALL respect source bounds and MIDI pitch limits without collapsing spacing. Unselected notes and note identities SHALL remain unchanged.

#### Scenario: Moving against a boundary
- **WHEN** a group is dragged before the source start or above pitch 127
- **THEN** the shared delta stops at the first member's boundary and relative timing and pitch intervals remain intact
- **AND** release writes one versioned atomic source edit that can be undone in one operation

### Requirement: Atomic group duration resizing
Dragging the right edge of a selected note SHALL add one shared grid-snapped duration delta to every selected note, preserving starts and pitches. The shared delta SHALL be bounded by minimum note duration, source end and valid vocal constraints. Imported timing SHALL not change until edited.

#### Scenario: Resizing unequal notes
- **WHEN** a group with unequal durations is lengthened by one grid step
- **THEN** every selected duration increases by that step and unselected durations remain unchanged
- **AND** the edit either succeeds for the entire group or leaves the accepted document unchanged

### Requirement: Cancellation and keyboard parity
Escape, pointer cancellation, lost capture, window blur, editor closure and source changes SHALL cancel transient transforms without submitting edits. Group keyboard movement and deletion SHALL honor selection, locks and vocal metadata; modal inputs SHALL retain their own shortcuts.

#### Scenario: Cancel during resize
- **WHEN** Escape is pressed during a group resize
- **THEN** the preview is discarded without closing the underlying editor or changing the accepted notes

#### Scenario: Locked or invalid vocal edit
- **WHEN** a group edit would violate a lock or monophonic vocal constraint
- **THEN** the whole edit is rejected, the selection remains available, and an actionable error uses the shared toast
- **AND** untouched syllable, pronunciation and expression assignments retain their note identities
