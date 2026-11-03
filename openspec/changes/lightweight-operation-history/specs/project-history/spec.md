# Spec Delta

## Purpose

Keep accepted project edits reversible and protected against stale writes without storing the full project again for every historical operation.

## ADDED Requirements

### Requirement: History stores only affected data
New edits and undo SHALL append history containing only changed fields or affected entities and necessary restoration metadata. Lock toggles SHALL NOT persist a full historical project snapshot. The current project document SHALL remain authoritative.

#### Scenario: Lock a track in a large project
- **WHEN** the user locks one track in a project with many unrelated tracks and clips
- **THEN** the new history payload contains its identifier and old/new lock values without unrelated content or a full project snapshot

#### Scenario: Remove and restore a track
- **WHEN** a track containing clips is removed and then undone
- **THEN** its original identifiers, clip data, settings, and track position are restored using the removed subtree

### Requirement: Undo traverses accepted edits sequentially
Undo SHALL reverse the latest active ordinary operation and append a compensating event. Undo events SHALL NOT themselves become undo targets. Actual undo availability SHALL be supplied to the client and survive restart.

#### Scenario: Undo two edits
- **WHEN** the user changes tempo, adds a track, and invokes undo twice
- **THEN** the track addition and then tempo change are reversed, with no oscillation between the two latest states

#### Scenario: Edit after undo
- **WHEN** the user undoes an edit, makes a new edit, then invokes undo
- **THEN** the new edit is reversed and the previously undone edit stays undone

#### Scenario: History is exhausted
- **WHEN** every active operation has been undone
- **THEN** the UI disables undo and the API rejects another undo without changing state or adding history

### Requirement: Conflict protection is atomic
Every edit and undo SHALL atomically compare the internal expected version and commit current state and history together. Stale and failed commands SHALL leave both unchanged. Existing lock validation SHALL remain effective.

#### Scenario: Two sessions edit the same version
- **WHEN** two independent sessions submit edits against the same project version
- **THEN** only one succeeds and the other receives a conflict without overwriting accepted state or appending history

#### Scenario: Edit a locked track
- **WHEN** a normal clip edit targets a locked track
- **THEN** the operation is rejected without changing the document or appending history

### Requirement: Existing projects retain history compatibility
Migration SHALL preserve current project documents, names, identifiers, counters, and legacy history. It SHALL be idempotent and transactional. Imported historical transitions SHALL remain reversible; migration failure SHALL not partially convert a project.

#### Scenario: Migrate an old project and restart twice
- **WHEN** an existing snapshot-backed project is upgraded and the application restarts twice
- **THEN** its current state is unchanged, history metadata is not duplicated, old transitions remain undoable, and new edits append only lightweight history

### Requirement: Internal counters stay out of the product UI
Project views SHALL omit version numbers while retaining internal counters for conflict protection. Producer commands and direct editing SHALL use the same authoritative mutation path.

#### Scenario: Toggle lock from the studio
- **WHEN** the user toggles a track lock
- **THEN** the lock updates without a displayed version number, and a subsequent stale command is still rejected
