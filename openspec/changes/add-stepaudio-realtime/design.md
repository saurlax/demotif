# Design

## Context

See proposal.md for motivation. `use-producer-voice.ts` currently uses MediaRecorder, uploads a finished turn, calls `session.sendText` and downloads complete TTS audio. `producer-voice.ts` implements the ElevenLabs endpoints. `src/pages/api/[...path].ts` forwards ordinary HTTP through `node-handler.ts`; no WebSocket upgrade handler exists. `settings.ts` strictly validates configuration. The pending contextual-music-workbench voice delta explicitly promises turn-based voice, so its wording needs reconciliation.

## Goals / Non-Goals

**Goals:** Add continuous realtime speech and reuse the existing Producer for project edits without moving browser transport or recording into a model service. Keep ordinary realtime conversation usable independently of the text model key.

**Non-Goals:** See proposal.md. In particular, microphone conversation is separate from vocal reference recording and does not create musical notes or automatically start song recording.

## Decisions

### Provider configuration and verified protocol

Read server-only `STEPFUN_API_KEY` and `STEPFUN_BASE_URL` (default `https://api.stepfun.com/v1`) through `src/server/settings.ts`. Add a `producer.realtime` configuration object for model and voice settings. Enable server_vad explicitly; leave thresholds and timing fields unspecified so StepAudio uses its provider defaults. Initial model is `stepaudio-3-realtime-preview`, voice `wenrounansheng`. Derive the WebSocket endpoint by appending `/realtime` and mapping https to wss. Keep these credentials separate from the text Producer gateway and ElevenLabs.

On 2026-11-09, a real authenticated connection returned `session.created` for this model with PCM16 input/output. `session.update` accepted the male voice, server VAD and a function tool and returned `session.updated`. Tool definitions use `{type:"function",function:{name,description,parameters}}`. A live streamed-audio test invoked the existing Producer, changed a disposable draft to 95 BPM and verified Undo restored 120 BPM. A separate live interruption test ended the old response as incomplete and completed the next response. Credentials are stored in Windows user environment variables and ignored project environment configuration.

Official references:
- https://platform.stepfun.com/cookbook/stepaudio-3-realtime
- https://github.com/stepfun-ai/Step-Realtime-Console

### Same-origin Node WebSocket relay

Use `scripts/server.ts` as an explicit Node entry point wrapping Next's request and upgrade handlers. Route `/api/projects/:projectId/producer/voice/realtime` upgrades to `src/server/producer-realtime.ts`; forward unrelated upgrades to a separate in-process Next upgrade dispatcher so HMR continues to work without also consuming voice sockets. Bundle the entry point with the existing esbuild toolchain for development and production. `run-server.mjs` loads server environment configuration before importing the bundle; backend changes require restarting development. Frontend HMR remains enabled.

Use `ws` for an authenticated upstream client and no-server downstream upgrade handling. Verify the project and local/runtime mode before accepting a session. Keep configured proxy deployments explicit: forward their upgrade to the configured owning backend, preserving project isolation, or return a clear unsupported result until the target supports this relay; never use local credentials to impersonate the remote project. Browser connections carry project context, never the provider key. Apply the existing deployment boundary rather than inventing a new account system or arbitrary host allowlist.

Alternatives: browser-direct persistent credentials expose secrets; a second sidecar port complicates local/hosted deployment; Pages HTTP handlers alone do not provide a stable explicit upgrade lifecycle. The custom Node entry point keeps one server and one port. Serverless deployments need an upgrade-capable hosted adapter.

### Browser audio and response identity

Add `src/audio/realtime-voice.ts`, an AudioWorklet capture processor and a tested streaming PCM conversion helper. Use mono signed little-endian PCM16 at the official cookbook's 24 kHz starting rate, confirming the exact live session format before capture. Resample correctly from the actual AudioContext rate; never relabel 44.1/48 kHz samples. Use short chunks, ordered scheduling and bounded buffers with explicit backpressure failure. Do not reuse DAW transport scheduling for voice speech.

On `session.created`, configure instructions, audio and tools, enabling server_vad with provider-default sensitivity and timing. Only enable capture after `session.updated`. Track response IDs, currently scheduled sources and discarded responses. On `input_audio_buffer.speech_started`, stop scheduled old speech, clear pending buffers and discard subsequent old-response deltas. Keep the microphone running. Explicit interruption also cancels upstream generation where supported. Stopping a connection tears down nodes, tracks, listeners and buffers; asynchronous continuations use a session generation guard.

### Producer delegation instead of a second editing engine

Expose one function, `edit_project(instruction)`, to realtime. The server calls the existing Producer run orchestration with an immutable turn context and expected version. Reuse current command validation, tool suite, draft application, job deduplication and history rather than execute model-authored raw mutations. Return the completed run's actual result through `conversation.item.create` function-call output and resume the spoken response through the provider response event. Verify function-call result and response event envelopes against the current official protocol during implementation, then test an actual invocation against a disposable draft.

Client selection updates and audio frames share an ordered session channel. Server VAD speech-start captures the most recently validated selection and accepted version for that turn. Do not silently rebase when the user edits mid-turn. Deduplicate function calls by session and call ID and serialize delegated runs to preserve the existing one-active-run policy. Cancellation requests stop owned running work; edits already committed remain in history and are never implicitly reverted. Include the relevant prior conversation summary when establishing voice sessions so returning to voice remains coherent.

### Existing UI and fallback

Split the old hook into a turn-based implementation and a transport-selecting facade. Keep the public start/end/interrupt/finish contract used by the composers; map finish to supported realtime input commit/turn control rather than terminating the microphone. Add server voice capability discovery independent of `session.ready`; disable musical delegation with an actionable result when the text Producer is unconfigured. Publish user and assistant turn transcripts plus linked Producer run IDs into existing history, refresh accepted draft changes through the existing controller and avoid duplicate chat items. No new standalone settings panel is required.

## Risks / Trade-offs

- Preview model or voice changes → make IDs configurable and surface configuration errors without automatic provider substitution.
- Speakers feed assistant audio into VAD → request echo cancellation, test with headphones and speakers, and retain the provider default turn detection.
- Full-duplex audio continues while edits run → deduplicate and serialize tool work, preserve turn IDs and version conflicts, discard stale responses.
- Custom Next server affects deployment and HMR → test both dev and production start, existing HTTP streaming/Range handling and unrelated upgrade delegation.
- In-memory voice history is lost on reconnect → persist completed transcript items through a narrow server conversation seam; do not persist raw microphone streams by default.

## Migration Plan

1. Add configuration and relay without changing existing text or audio job routes.
2. Switch dev/start to the explicit Node entry point and verify normal HTTP and HMR behavior.
3. Enable realtime voice by credential presence; keep turn-based behavior when absent.
4. Reconcile the pending contextual-producer voice delta, update `.env.example`, example config and README.
5. Roll back by disabling realtime configuration and restoring prior startup scripts if necessary. Project model storage and operation history require no schema migration for audio transport itself; persist transcript linkage through the existing conversation schema where possible.
