## ADDED Requirements
### Requirement: Persistent local S3 experiments
The workspace SHALL support an explicitly started loopback S3 development service with persistent objects and browser CORS. It SHALL reuse existing storage settings without changing model credentials.

#### Scenario: Restart the emulator
- **WHEN** the local service restarts
- **THEN** previously accepted objects remain readable

### Requirement: Local transfer compatibility
Loopback storage SHALL use path-style addressing and documented public development credentials without calling remote STS. Remote transfers SHALL retain their existing HTTPS and temporary authorization behavior. A local browser session SHALL reject credentials other than the known emulator test pair.

#### Scenario: Direct local upload
- **WHEN** a browser uploads an owned asset to loopback S3
- **THEN** completion validates checksum and length and publishes the asset with the normal ownership rules

### Requirement: Verified storage cutover
Existing accepted asset and catalog references SHALL be copied and digest-verified before local configuration is switched. Originals and configuration backups SHALL remain available.

#### Scenario: Copy fails
- **WHEN** an object cannot be copied or its digest differs
- **THEN** configuration remains on the original store and the failure exposes no credentials
