## Context

The app stores notes in quarter-note beats. YuE2 emits two monophonic melody voices and chord symbols in a specific ABC dialect.

## Goals / Non-Goals

Generate a lead sheet and place its editable melodies through the Producer. Render the YuE2 song to a stereo audio Clip on explicit request. Arrangement-wide tempo edits and rendering edited project Clips through YuE2 are future work.

## Decisions

- Call the deployed Modal worker from Node using its authenticated SDK. Keep the feature opt-in by Modal app name.
- Add a worker method that validates ABC with the parser shipped by the pinned YuE2 source and returns numeric note events. Preserve the current raw planning and rendering methods.
- Validate remote results with Zod and stage both melody Clips and the source score through the existing versioned command path. Adopt the initial score settings when starting an empty arrangement at beat zero. Existing arrangements keep their project settings and overlapping section labels. Preserve score-relative events and the placement separately.
- Use the upstream parser's sounding notes, measure grid and key changes. Read section comments at the corresponding parsed measure boundaries, including expanded multi-measure rests. Keep the original ABC and separately supplied lyrics for future reuse. The studio uses a single global meter and tempo for playback.
- Split each melody at parsed barlines where no note is sounding across the boundary. Skip silent ranges and reuse one source for exact repeats of the same voice, normalized timing and length.
- Use YuE2 Render by default for new composition and substantive arrangement. Import the ABC from that same render and stage the stereo mix and editable note Clips together. Mute the note tracks initially to avoid doubling the mix. Explicit Plan-only requests use the score planner. Existing local edits handle targeted corrections.
- Keep the web app and the GPU worker as separate deployment units. The web app owns SQLite, and the browser owns playback.
- Read the existing Modal call in short polls. Retry transient transport failures within the run deadline and log the call ID and error metadata for a terminal failure.
- Publish validated FLAC to the project media store and stage one undoable audio track and Clip at the requested beat.

## Risks / Trade-offs

GPU scheduling adds latency. The Producer cancellation signal must prevent late results from staging edits. Malformed or truncated scores require an explicit new request. The app currently has no chord symbol editor.
