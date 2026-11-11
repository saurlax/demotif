<h1 align="center">Demotif</h1>

<p align="center">An AI music creation workspace.</p>

Demotif combines a browser music studio with a conversational producer. Arrange reusable clips, edit notes and drum patterns, import audio, mix tracks, and export WAV. The producer proposes reversible edits for review before they enter the project.

## Studio

- Multitrack playback, drag seeking, section markers, zoom, panning, and centered playhead following.
- Shared sources and reusable clips with independent placements: move, trim, split, duplicate, or return a clip to the library.
- Piano roll, drum sequencer, velocity, transpose/quantize, press-and-glide audition, and clip loops.
- 60 built-in sounds: synthesis voices, drum kits, samples, effects, and CC0 sampled instruments.
- Track/master/bus mixing, effects, routing, automation, and stereo 44.1 kHz/16-bit WAV export in the browser.
- Isolated editing drafts, explicit Save/Save as with cross-tab version checks, JSON import, multiple local examples, locks, and persistent undo. Examples require Save as; unsaved edits prompt before internal navigation, with native departure protection for refresh and tab closure where supported.
- Optional TypeScript producer with persisted conversation events, streaming progress, explicit proposal application, cancellation, and reconnect support.
- Optional OpenRouter music and speech generation, with persistent reviewable results and no automatic paid resubmission.
- Optional monophonic/percussion transcription on Modal for audio excerpts up to 30 seconds.

Vocal editors support [lyric-guided microphone reference recording](docs/vocal-recording.md), take review/re-record, WAV download and explicit saving into the current draft. Live pitch correction, authentication, and hosted deployment remain future work.

## Development

Requires Node.js 24+ (including native `node:sqlite`). The application is Next.js 16 App Router with React, TypeScript, Tailwind v4 and shadcn/Base UI. Next.js serves both the workspace and `/api`; no separate API server is required.

```bash
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). Run `npm run build` and `npm start` for a production build. `npm test` runs browser-audio and server tests; `npm run typecheck` checks both sides. Run `npm run lint` for lint checks.

YuE2, Chinese and Japanese singing, and audio processing run as [private Modal workers](workers/README.md).

Copy `.env.example` to `.env.local` for server credentials. See Server configuration below for the shared OpenRouter connection.


SQLite stores projects, drafts, history, conversations, jobs and catalog metadata locally. S3 owns durable audio, voice resources and exports. Back up SQLite and its referenced objects together. Local API ownership is the default; proxy runtimes must explicitly select their backend in demotif.config.json. See [storage configuration](docs/architecture.md#shared-workspace-storage).

## Existing local installations

Stop the old API before switching writers. Run the one-time copy command before starting Next.js:

```bash
npm run migrate:local -- /path/to/legacy-server
```

It copies the old database with SQLite's backup API, copies media/examples without replacing existing destination files, and leaves credentials unchanged. Original files remain intact. The destination database is never overwritten. The new server also creates `data/demotif.db.pre-nextjs.bak` before its first database initialization. Do not run the old API against the active database concurrently. Custom absolute storage paths should be checked separately before cutover.

## Optional transcription

Only this offline tool needs Python 3.13; the web application and producer do not.

```bash
uv sync --project analysis
uv run --project analysis pytest
```

Set `DEMOTIF_MEDIA_MODAL_APP=demotif-media` on the Next.js host to enable the private media worker. The local uv commands above run the offline analysis tests.

Project JSON does not embed media: references must exist in the local workspace. Audio imports accept up to eight files per batch, each up to 60 MB and five minutes. Recordings retain their original speed when tempo changes.

Third-party attribution is retained in `resources/sounds/catalog.json`, `resources/licenses/`, and `branding/OFL.txt`. See [architecture](docs/architecture.md) for runtime boundaries, persistence, and command semantics.


## Contextual music workspace

Audio capabilities distinguish music, speech, sound effects, score-driven singing and audio-to-notes. ElevenLabs provides remote audio, OpenRouter serves Producer language models, and Modal runs native singing and note analysis. A Sound is an audio Clip, not necessarily a sound effect.

Producer starts as a compact floating composer with its history sidebar closed. Select a Clip and describe the desired conversion or style in the input, or use the applicable right-click actions. Both routes use the same Producer tools and selected Clip, source window, instrument/sample and destination context. Empty-space clicks select a destination; only sending an instruction or choosing a menu action starts work. The sidebar retains the full Markdown conversation and an Undo changes action; model selection sits in the input footer.

`render_clip` renders accepted notes, instrument/samples and effects in the browser, with an optional isolated instrument change. Musical style variations use actual audio references with Music v2/v2.5; note Clips can first render a reference without staging an intermediate Clip. References are explicit owned excerpts of up to 30 seconds. ElevenLabs requires uploads of at least 10 seconds, so shorter excerpts repeat only in the uploaded reference; conditioning still selects the original excerpt and requested output length stays unchanged. Reference upload and generation are separate charged requests, without automatic retries or prompt-only fallback. Generated interpretations may change notes. Audio-to-notes analysis supports an excerpt up to 30 seconds and stages a muted editable note track. New Producer runs automatically apply their validated batch to the draft as one undoable operation, preserving original Clips for conversions. Version conflicts retain the result without overwriting user edits. Save remains explicit.

In the piano roll, drag empty space to select notes, Shift-drag to add, and Shift-click notes to toggle selection. Drag a selected note to move the group, or its right edge to add/subtract the same snapped duration from the group. Arrow keys move the selection; Shift uses larger increments. Ctrl/Cmd+A selects notes only within the editor. Escape cancels a gesture, and right-click still deletes an individual note. Group edits retain note IDs and submit once on release; locked or invalid edits fail atomically.

Interrupted remote generations are never automatically resubmitted or resumed. Completed results remain in draft history. Choose a current destination explicitly after version changes. Completion neither edits nor saves a project; cancellation does not imply a refund.

The studio transport includes a metronome toggle beside Play and Stop. It follows project BPM and time signature, accents each bar's first pulse, and can run on its own while stopped. Starting playback with clicks already running waits for the existing pulse grid; enabling clicks during playback joins the next song pulse. Pause silences clicks while retaining the setting for resume; Stop turns them off. The setting is local to the editing session and the clicks are excluded from WAV exports.

[Performance recording](docs/performance-recording.md) starts from Record beside Mixer. Microphone/count-in settings are in the upper-right header; Undo is with arrangement editing controls. Each recording automatically becomes an ordinary audio Clip on a new unmuted track, with no separate keep-take step. Re-recordings preserve prior tracks; existing mute/solo and Clip editing handle comparison and reuse. Producer can prepare recording through an acknowledged browser control, and counted capture holds realtime conversation until recording ends. Explicit project Save remains required. Vocal reference recording retains its separate optional count-in.

Chat-driven humming/singing uses `record_audio`: Producer first resolves the phrase, destination and start/end range, then records without a Record click and automatically stops at the agreed end. Dry capture and optional audio-to-notes follow-up reuse the ordinary audio/analysis paths. Verified placement returns fresh Clip context to the conversation. Producer also exposes explicit Save/Save as and WAV export tools through the existing browser file workflow.

## Server configuration

Set `DEMOTIF_LLM_API_KEY` and `DEMOTIF_LLM_BASE_URL=https://openrouter.ai/api/v1` for the text Producer. The URL defaults to the official OpenRouter endpoint. These credentials are not used for realtime speech or batch audio.

Set `DEMOTIF_ELEVENLABS_API_KEY` in ignored `.env.local` for direct ElevenLabs audio: Music v2/v2.5 (3–300 seconds, instrumental or supplied lyrics), Sound Effects v3 (0.5–30 seconds, one-shot or seamless `loop`), discovered TTS/voice-conversion models and accessible voices, Scribe v2 speech recognition, speech isolation (at least 4.6 seconds of input) and text/audio alignment. The Producer selects models through `list_audio_models` and `process_audio`; no standalone generation form is added. Recognize returns words/text, align returns text timings, while local transcribe remains audio-to-notes. Speech isolation removes background noise; full music stem separation, exact MIDI-conditioned generation, voice training and image/video integrations are not advertised. Remote permissions and credits are checked by the provider at submission; catalog discovery does not guarantee access to every endpoint. Enable Models access and Voices read for voice discovery, plus each audio endpoint you intend to use. No paid retries or model fallback are automatic.

Set server-only `STEPFUN_API_KEY` and optionally `STEPFUN_BASE_URL` (default `https://api.stepfun.com/v1`) for StepAudio 3 Realtime WebSocket voice. The empty Producer input's waveform button starts continuous voice with streamed replies and interruption. The default model is `stepaudio-3-realtime-preview`, with `wenrounansheng` voice. Override model and voice values under `producer.realtime` in `demotif.config.json`. Realtime conversation works independently of text-model readiness; musical edits delegate to the configured text Producer and remain undoable draft changes. Voice conversations and delegated results persist in the same history. Ending voice, changing project or hiding the page stops the microphone and speech. Connection failures require starting voice again and never replay edits automatically.

After microphone setup, realtime Producer opens with a brief greeting, referring to recent creative discussion when available. Active voice controls show hang-up only; speak to interrupt a reply. The opening does not perform musical edits or create a fake user message in history.

Without a StepFun key, turn-based voice retains ElevenLabs STT/TTS and the existing Producer. Speech conversation requires neither S3 nor local Python. Recording song vocals and converting a hummed recording to notes remain separate workflows. Durable generated/imported audio still requires the configured object store.

`npm run dev` and `npm start` run the Node HTTP/WebSocket server on port 5173. `PORT` changes the port; `NEXT_DIST_DIR` isolates build output for parallel verification. Development rebuilds the server bundle on startup; restart after backend changes, while Next retains frontend HMR. Production requires `npm run build` before `npm start`. Deploy behind a reverse proxy that forwards WebSocket upgrades; serverless HTTP-only deployment cannot serve this voice transport. A proxy runtime relays voice to its configured owning backend and does not open a second local database or reuse local provider credentials for remote projects.

Copy `demotif.config.example.json` to ignored `demotif.config.json` only when overriding defaults. Producer defaults to DeepSeek Flash and its model can be selected in the sidebar. The default preset list contains only DeepSeek Flash; advanced deployments may specify another OpenRouter model with `producer.model`. Optional `producer.settings` holds model settings. Local API ownership is the default. An explicitly selected `runtime` object with `mode: "proxy"` and `upstream` forwards API calls before opening local SQLite, with no local fallback.

Server runtime inputs are `DEMOTIF_LLM_API_KEY`, `DEMOTIF_LLM_BASE_URL`, `DEMOTIF_ELEVENLABS_API_KEY`, `STEPFUN_API_KEY`, `STEPFUN_BASE_URL`, `DEMOTIF_S3_ACCESS_KEY_ID`, `DEMOTIF_S3_SECRET_ACCESS_KEY`, and optional `DEMOTIF_DATA_DIR` (default `./data`). Database, media, examples and models are derived from this one data directory. Python executables are derived from the documented virtual environments using `Scripts/python.exe` on Windows and `bin/python` elsewhere. Set `singing.device` in the config file to select `cpu`, `cuda` or `mps`.

S3 remains the durable binary store. Set `storage.endpoint`, `storage.bucket`, optionally `storage.region` and `storage.prefix` in the config file; keep its two credentials in the environment. Default region is `us-east-1` and prefix is `demotif/`. Local API ownership alone does not provide offline storage. Missing storage configuration is reported as unavailable rather than silently proxied.

For existing configuration, `npm run migrate:config` is a non-mutating dry run. Use `npm run migrate:config -- --local` to preview conversion to local API ownership, then add `--apply` to perform it. Conflicting old keys, unsupported endpoints or custom data layouts stop conversion. Original files receive `.config-backup` copies; no data files move. Repeat application is a no-op. Roll back with the original configuration files and compatible server version. Never commit deployment files or backups.

The Modal media worker handles audio conversion, probing and transcription. Model catalog availability, formats and voices are validated before submission. Interrupted remote generations are never automatically resubmitted; accepted audio remains playable without provider access.

## Local audio experiments

Use `npm run dev:local` to start the UI/API on 127.0.0.1:5173 and persistent development S3 on 127.0.0.1:4569 together. `npm run dev:s3` starts only storage. Objects remain in ignored `data/s3/` across restarts. The emulator is a development-only S3rver service bound to loopback.

The ignored `demotif.config.json` storage settings are `{"endpoint":"http://127.0.0.1:4569","bucket":"demotif-local","region":"us-east-1","prefix":"demotif/"}`. Use the documented public emulator test pair `S3RVER` for both existing S3 credential variables in `.env.local`. No extra environment variables are introduced; LLM and ElevenLabs settings are independent.

To move an existing workspace, start `npm run dev:s3`, stop the app to keep the object inventory stable, and run `node scripts/migrate-to-local-s3.mjs --apply`. It backs up SQLite and ignored settings under `data/backups/`, copies accepted objects and catalogs with digest/length verification, then switches settings. Remote originals remain unchanged. To roll back, stop the app, restore only the backed-up local settings, and restart. New local objects must be copied to the destination before any later production cutover.

Instrumental sampler notes can carry an optional `sample` window with source-audio `offset`/`duration` in seconds and `rootNote`. Select a mapped note to edit these in its note dialog. Moving the note preserves its original window; pitch changes are relative to its captured root. A window stops at its end rather than reading adjacent syllables. This supports syllable/attack slicing but does not provide independent time-stretch or formant preservation. Legacy sampler settings remain compatible. Offline export prepares only audible track assets, so muted references and unused alternatives do not allocate full-song render buffers. Fit arrangement supports long-song overviews with readable ruler spacing.
