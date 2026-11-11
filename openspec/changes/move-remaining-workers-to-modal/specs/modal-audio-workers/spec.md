## ADDED Requirements

### Requirement: Use Modal for native audio workers

Demotif SHALL run score-driven vocals and offline audio processing through authenticated Modal workers.

#### Scenario: Render Japanese singing

- **WHEN** a user renders a Japanese vocal Clip
- **THEN** the Modal CPU worker runs the validated NNSVS voice and Demotif publishes the checked audio result

#### Scenario: Process project audio

- **WHEN** the backend needs to analyze, convert or probe owned audio
- **THEN** it uses the Modal media worker and retains the existing job and asset protocols
