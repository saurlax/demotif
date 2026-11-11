## Decisions

- Keep the Japanese NNSVS runtime on CPU and package the verified CRISSCROSS weights, matching vocoder implementation and Japanese dictionary. Preserve its existing score context and controls.
- Deploy the existing audio-to-notes analyzer alongside FFmpeg and FFprobe. Use named operations and pass owned input bytes through private Modal calls.
- Preserve existing asset reads, audio job identifiers and project edits. Browser playback, recording and mixing remain browser-owned.
