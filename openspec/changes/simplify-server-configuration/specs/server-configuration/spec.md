# Spec Delta

## Purpose

Provide a small, explicit server configuration contract that keeps credentials private and makes local versus proxied API ownership predictable.

## ADDED Requirements

### Requirement: Minimal runtime environment inputs
The server SHALL accept only one shared model credential, one shared model base URL, two storage credentials and one optional data-directory variable as application runtime environment configuration. Test-only switches SHALL NOT alter normal runtime configuration.

#### Scenario: Default startup
- **WHEN** no application environment variables or deployment configuration are supplied
- **THEN** paths resolve beneath the repository data directory and optional providers remain unavailable without preventing basic project editing

### Requirement: Explicit API ownership
The server SHALL own its local API and SQLite by default. Forwarding SHALL require an explicitly configured proxy mode and upstream URL. A proxy SHALL NOT initialize local SQLite or fall back to local mutations when upstream fails.

#### Scenario: Explicit proxy
- **WHEN** a deployment selects proxy mode with a valid upstream URL
- **THEN** all API calls use that upstream and no local workspace is opened

#### Scenario: Legacy upstream input
- **WHEN** a removed upstream environment variable remains configured
- **THEN** startup reports its name and migration action without forwarding silently or exposing its value

### Requirement: Validated non-secret settings
The server SHALL load necessary non-secret deployment settings from one optional configuration file, reject unknown fields and invalid values, and keep credentials exclusively in server-side environment inputs. Official fixed endpoints and standard worker executable paths SHALL NOT require deployment settings.

#### Scenario: Invalid configuration
- **WHEN** configuration contains an unsupported field, credential field or invalid mode
- **THEN** startup fails with field names and actionable guidance without logging configuration values

### Requirement: Unified remote model transport
All remote model requests SHALL use OpenRouter with the same configured model credential and base URL. Unsupported remote capabilities SHALL reject before submission. Native local processing SHALL remain independent. No alternative remote adapter or internal protocol SHALL remain.

#### Scenario: Shared connection
- **WHEN** Producer, music or speech requests are submitted
- **THEN** they use the same configured key and base URL with the appropriate OpenRouter endpoint

#### Scenario: Unsupported capability
- **WHEN** an unimplemented remote capability is requested
- **THEN** it fails without contacting an alternate provider

### Requirement: Safe configuration migration
Migration SHALL default to a non-mutating dry run, preserve credentials and original files on apply, report names rather than values, and refuse mappings that would silently relocate existing data. Removed runtime variables SHALL produce actionable migration errors rather than being silently ignored.

#### Scenario: Custom historical data paths
- **WHEN** legacy database and media paths cannot be represented by one data directory
- **THEN** migration stops with a path-layout conflict and does not move files or select a new empty database

#### Scenario: Repeated apply
- **WHEN** migration is applied again to an already migrated configuration
- **THEN** it preserves existing settings and backups without creating additional changes

### Requirement: Clean repository history
All reachable repository history and current source SHALL exclude removed internal integration names, dedicated adapters and protocol details. History rewriting SHALL preserve current uncommitted work and an external recovery backup.

#### Scenario: All-ref verification
- **WHEN** the repository and remote branch history are scanned after cleanup
- **THEN** no removed integration content is reachable through retained refs
