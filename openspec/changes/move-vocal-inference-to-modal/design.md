## Decisions

- Give vocal inference its own Modal App and warm singer instance. Keep the demo checkpoints in a private read-only Volume with the upstream notices.
- Register the remote voice using the same profile manifest on both sides. Reuse the native score compiler and waveform checks.
- Pass the immutable phrase snapshot and return WAV bytes plus alignment through authenticated Modal RPC. Node owns the request lifecycle, cache, version checks, and durable asset publication.
- Keep GPU containers at zero when idle. Include the backend in the render fingerprint and keep cancellation tied to the originating job.
