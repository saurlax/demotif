## Purpose

Provide a private on-demand GPU worker for evaluating YuE2 symbolic planning and audio rendering.

## ADDED Requirements

### Requirement: Authenticated on-demand inference

The deployed worker SHALL expose authenticated Modal operations for health, ABC planning, and full-song rendering. The worker SHALL scale to zero when idle.

#### Scenario: Verify deployment connectivity

- **WHEN** an authorized caller invokes health
- **THEN** the worker reports GPU and model readiness without generating a score or rendering audio

#### Scenario: Request music after connectivity validation

- **WHEN** an authorized caller invokes planning or rendering
- **THEN** planning returns the ABC score and rendering returns the full audio with its associated score when available
