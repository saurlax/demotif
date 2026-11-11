## ADDED Requirements

### Requirement: Lock Python GPU worker dependencies

The repository SHALL define a uv project and checked-in dependency lock for each of its Modal GPU workers. Both GPU images SHALL install their Python dependencies from the corresponding lock.

#### Scenario: Rebuild a worker image

- **WHEN** an operator deploys either Modal worker from the repository
- **THEN** the image uses that worker's locked dependencies and preserves its existing callable methods
