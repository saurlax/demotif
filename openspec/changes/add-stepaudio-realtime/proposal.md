# Proposal

## Why

Producer voice currently records a complete turn, transcribes with ElevenLabs, invokes the text Producer and synthesizes its completed reply. Connecting StepAudio 3 Realtime enables continuous speech interaction and interruption while retaining real project editing.

## What Changes

- Add server-only StepFun credentials and configurable realtime model, endpoint and voice. Use `stepaudio-3-realtime-preview` with the China endpoint initially.
- Relay authenticated WebSocket sessions through Demotif's Node server without delivering provider credentials to the browser.
- Stream browser microphone PCM and streamed reply audio, transcripts and server VAD events; stop stale reply audio immediately on interruption.
- Expose a realtime tool bridge to the existing Producer, retaining selected Clip/note context, captured versions, draft-only commands, locks and undo.
- Use realtime voice when configured; preserve existing turn-based voice when it is not configured. Show connection errors rather than silently switching providers mid-session.

## Capabilities

### New Capabilities

- `producer-realtime-voice`: Continuous, interruptible voice sessions with server-owned credentials and validated Producer editing integration.

### Modified Capabilities

None in main specs (the main spec inventory is empty). This change supersedes the ElevenLabs-only voice entry requirement in the pending `contextual-music-workbench` change when realtime is configured; that pending delta must be reconciled during implementation.

## Impact

Touches browser audio, provider and HTTP/WebSocket adapter boundaries; server model mutations remain owned by existing Producer command handling. A Node upgrade-capable entry point and the `ws` package are needed because the current Pages API handler only handles HTTP requests. Configuration, dev/start scripts, voice entry UI and tests change.

Non-goals: accompaniment-synchronized vocal recording, take comping, humming-to-notes capture, WebRTC, changing the text Producer default, generating the introduction film, and replacing ElevenLabs music/audio jobs. Realtime speech understanding alone does not persist a hummed motif as editable notes.
