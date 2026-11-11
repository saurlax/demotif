## Purpose

Expose truthful, categorized audio model capabilities and reliable generation results through the existing project-owned media workflow.

## ADDED Requirements

### Requirement: Categorized capability discovery
The system SHALL distinguish song/instrumental generation, speech, sound effects, score-driven singing, and audio-to-notes analysis. A model SHALL expose only verified controls, readiness, formats and duration constraints, with an actionable reason when unavailable.

#### Scenario: Speech is distinct from singing
- **WHEN** a user chooses a speech model
- **THEN** the interface identifies it as speech and does not offer exact musical-note control or advertise it as a song generator

#### Scenario: Current ElevenLabs catalog
- **WHEN** ElevenLabs credentials and model availability are valid
- **THEN** implemented ElevenLabs audio categories are discovered independently of the LLM connection
- **AND** unsupported providers and retired OpenRouter audio presets are excluded

### Requirement: Provider-specific validation
Generation requests MUST validate model identity, category and supported parameters before submission. Unsupported reference-audio, pure-vocal, exact-note and duration controls MUST NOT silently become promises that the selected provider cannot honor.

#### Scenario: Prompt-only melody variation
- **WHEN** a model cannot consume an existing Clip as a musical reference
- **THEN** the interface explains that limitation before submission and does not present prompt-only generation as faithful conversion

### Requirement: Durable and deduplicated audio jobs
The system SHALL persist model/provider identity, immutable musical input context, job state and published media. Repeated requests with the same identity SHALL reuse their job. An uncertain paid submission MUST NOT be automatically resubmitted or silently routed to another paid model.

#### Scenario: Connection lost during generation
- **WHEN** a connection fails after a request might have been charged
- **THEN** the job reports an interrupted or uncertain outcome and a retry does not automatically create another generation

#### Scenario: Completed media belongs to the draft
- **WHEN** an audio job completes successfully
- **THEN** the returned audio is validated and persisted in the existing owned-media store before review
- **AND** completion alone does not modify the accepted document or explicitly save its draft

### Requirement: Independent availability and credential privacy
Music, speech, native singing and analysis SHALL report readiness independently. Credentials MUST remain server-side and MUST NOT appear in prompts, run events, errors, tracked files or browser payloads.

#### Scenario: Producer is unconfigured
- **WHEN** ElevenLabs is configured but no Producer text model is selected
- **THEN** direct supported audio capabilities remain discoverable while unsupported remote capabilities remain unavailable

#### Scenario: Authentication failure
- **WHEN** a provider rejects an expired or invalid credential
- **THEN** the user receives a sanitized error through the shared toast and no automatic login, account switching or credential disclosure occurs

### Requirement: Direct ElevenLabs audio routing
The system SHALL use a dedicated server-only DEMOTIF_ELEVENLABS_API_KEY for verified music, one-shot/loop effects, speech synthesis, voice conversion, speech isolation, recognition and alignment. LLM connection settings SHALL be reserved for language and future Realtime transport. This supersedes the initial OpenRouter catalog scenario above.

#### Scenario: Independent audio connection
- **WHEN** ElevenLabs is configured and the LLM connection is absent
- **THEN** supported audio capabilities remain discoverable without sending requests to the LLM base URL
- **AND** unavailable permissions and missing storage are reported truthfully

#### Scenario: Text-only analysis result
- **WHEN** speech transcription or forced alignment completes
- **THEN** text and validated timestamps are persisted for conversation review
- **AND** the system does not invent notes or offer to apply a text result as an audio Clip

#### Scenario: No automatic paid replay
- **WHEN** an ElevenLabs request fails or is interrupted after submission
- **THEN** its job is retained without retrying or falling back to another paid model
