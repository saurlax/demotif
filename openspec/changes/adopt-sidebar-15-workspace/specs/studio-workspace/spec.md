# Spec Delta

## Purpose

Provide a coherent music-editing workspace where users can navigate projects, view their arrangement, and consult the AI Producer without losing access to editing controls.

## ADDED Requirements

### Requirement: Studio presents navigation, arrangement, and assistance
The workspace SHALL display project navigation on the left, the arrangement centrally, and Producer assistance on the right on wide screens. Sample company, account, calendar, and unrelated demo navigation SHALL NOT appear.

#### Scenario: Open an existing project
- **WHEN** the user opens an existing studio project on a wide screen
- **THEN** navigation, that project's arrangement, and Producer are visible in their respective regions

### Requirement: Project navigation uses actual projects
The workspace SHALL allow returning to the project index and opening existing projects. Unimplemented material-library features SHALL be labelled unavailable and SHALL NOT imply functioning navigation.

#### Scenario: Choose a project
- **WHEN** the user chooses an existing project in the left navigation
- **THEN** the studio opens the selected project using its actual project identifier

### Requirement: Workspace remains usable at narrow widths
The workspace SHALL provide access to navigation and Producer on narrow screens through labelled controls. Project cards SHALL remain readable without the fixed form column squeezing them into narrow tiles.

#### Scenario: Open Producer on a narrow screen
- **WHEN** the user activates the Producer control on a narrow screen
- **THEN** a usable Producer panel appears and can be dismissed to return to the arrangement

#### Scenario: View project index in a narrow content region
- **WHEN** available content width cannot accommodate the creation form and readable project tiles side by side
- **THEN** the form and project list stack or wrap without squeezing project names and dates into narrow columns

### Requirement: Layout changes preserve project behavior
Project creation, track selection and locking, command application, undo, and Producer messaging SHALL retain their existing behavior. Toggling Producer visibility SHALL preserve its conversation for the current project. The server SHALL remain authoritative for project mutations.

#### Scenario: Toggle Producer visibility
- **WHEN** the user hides and reopens Producer within the same project
- **THEN** the current conversation remains available

#### Scenario: Apply a Producer proposal
- **WHEN** the user applies an offered edit
- **THEN** the existing versioned command path applies the edit and updates the visible accepted project state
