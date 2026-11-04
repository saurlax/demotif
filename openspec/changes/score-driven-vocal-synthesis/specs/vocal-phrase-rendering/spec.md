## Purpose

Turn accepted vocal scores into reusable, aligned singing audio through asynchronous inference without coupling browser transport timing to model execution or hiding incomplete output.

## ADDED Requirements

### Requirement: Truthful installed voice capabilities
The system SHALL expose installed voices with their supported languages, controls, readiness and required attribution. It SHALL distinguish missing models, unsupported configurations and worker failures. Third-party voice/model availability and commercial output permission SHALL NOT be represented as permission to redistribute or host those models.

#### Scenario: Incomplete voice installation
- **WHEN** an installed profile lacks a required acoustic, pronunciation or vocoder component
- **THEN** the voice is reported unavailable with the missing component identified, while existing non-vocal features remain usable

### Requirement: Synthesize an immutable accepted vocal score
A synthesis request SHALL reference an accepted source and project version and produce a render snapshot. The system SHALL use the selected voice, scored note timing, lyrics, pronunciation overrides and supported expression to generate singing audio. It SHALL NOT substitute text-to-speech, arbitrary whole-song generation or an unrelated synthetic tone as a successful vocal render.

#### Scenario: Score changed before submission
- **WHEN** a render is requested against an outdated project version
- **THEN** the request reports a version conflict rather than rendering unspecified current or client-only content

#### Scenario: Pronunciation and sustained note
- **WHEN** a valid score includes a pronunciation override, a sustained syllable and a rest
- **THEN** the output reflects that pronunciation and sustain while preserving the rest and scored alignment

### Requirement: Non-real-time inference is independent of live transport
The system SHALL allow heavy singing inference to run server-side and SHALL return a job without holding an application request open for full inference. Browser transport and existing instrument playback SHALL NOT depend on a model request completing inside the audio callback. Final audio quality SHALL NOT be silently lowered to fit browser execution or to meet an unmeasured latency promise.

#### Scenario: Render during instrumental playback
- **WHEN** a vocal render runs while existing instrumental tracks are playing
- **THEN** playback timing continues independently and the user can inspect or cancel the vocal job

### Requirement: Durable observable jobs and cancellation
Queued and running vocal requests SHALL have persistent status and truthful progress stages. Duplicate equivalent requests SHALL reuse work. Cancellation SHALL prevent unnecessary publication and SHALL NOT destroy a result needed by another active request. After a worker/application interruption, queued or interrupted work SHALL remain identifiable and recoverable without pretending it completed.

#### Scenario: Restart during inference
- **WHEN** the model process or application stops during a render
- **THEN** the result is not reported ready, partial files are not used for playback, and the request can be retried

#### Scenario: Cancel queued work
- **WHEN** a user cancels a queued request that has no remaining subscribers
- **THEN** the request does not start and its final visible state is cancelled

### Requirement: Reuse audio only for matching musical content
The system SHALL reuse results only when voice/model/compiler configuration, pronunciation, score timing, expression, relevant phrase context, tempo, seed and quality match. Moving an arrangement clip or changing mix controls SHALL NOT require recomputing its unchanged vocal performance. A late result SHALL NOT replace audio for a different current source fingerprint.

#### Scenario: Edit lyrics while rendering
- **WHEN** a user edits lyrics after an older render starts and that older render completes later
- **THEN** the old result remains non-current and the editor continues to identify the new score as needing synthesis

#### Scenario: Move a clip without changing its source
- **WHEN** a ready vocal clip is moved to another arrangement position
- **THEN** its existing rendered performance is reused at the new position

#### Scenario: Undo to previously rendered score
- **WHEN** undo restores a score whose matching result is still cached
- **THEN** the system can reuse that result without treating it as stale

### Requirement: Aligned playback and loops
Prepared vocal audio SHALL retain model lead-in, scored onset and release metadata and use the same timeline mapping for seek, trim, repeated placements, clip loops and export. Editing tempo SHALL invalidate affected vocal results rather than changing playback rate and thereby changing pitch. Newly completed results SHALL be adopted on a defined preparation boundary rather than replacing a playing buffer unpredictably.

#### Scenario: Seek into a reused vocal clip
- **WHEN** the user seeks into a trimmed placement of a ready vocal source
- **THEN** playback starts at the matching source time with the same alignment used by the complete mix

### Requirement: Complete and identifiable export
Before a complete mix export, the system SHALL resolve all audible vocal phrases in final quality against an immutable accepted score snapshot. Missing, stale or failed required renders SHALL cause visible preparation/progress or an actionable failure, not a silently incomplete or stale export. Users SHALL explicitly mute vocal tracks to audition accompaniment when vocal output is unavailable; the studio SHALL NOT expose a separate instrumental-audition toggle.

#### Scenario: Missing vocal output at export
- **WHEN** the user exports a mix containing an audible unrendered vocal source
- **THEN** the system prepares the required vocal audio or explains why export cannot complete without downloading a misleading partial mix

#### Scenario: Score changes during export
- **WHEN** the user edits the score while an export snapshot is being prepared
- **THEN** the exported result remains tied to the identified snapshot and does not combine phrases from different score states

### Requirement: Preserve editable score and usable output across saves
Saving, saving as, opening independent drafts and reopening projects SHALL preserve the editable vocal source and valid project-scoped access to matching available render assets. A missing derivative result SHALL be regenerable from the score. Render completion alone SHALL NOT advance the score version or overwrite saved project content.

#### Scenario: Save as after synthesis
- **WHEN** a synthesized vocal draft is saved as a new project and reopened
- **THEN** the new project retains its score and can resolve or regenerate its matching audio without depending on the old draft's asset ownership
