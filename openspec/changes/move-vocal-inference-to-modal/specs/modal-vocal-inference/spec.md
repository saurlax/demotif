## Purpose

Run GPU vocal inference on demand from an independently hosted Demotif backend.

## ADDED Requirements

### Requirement: Remote vocal rendering

A configured GPU voice SHALL render through an authenticated Modal function and return audio to the existing vocal job pipeline.

#### Scenario: Render a vocal Clip

- **WHEN** a valid vocal phrase targets the configured GPU voice
- **THEN** Node validates and publishes the returned WAV and alignment through its existing asset path

#### Scenario: Cancel a remote render

- **WHEN** the last request for an active job is cancelled
- **THEN** the backend requests cancellation and rejects any late result
