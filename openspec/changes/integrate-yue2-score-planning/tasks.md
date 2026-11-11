## 1. Integrate score planning

- [x] 1.1 Expose parsed native YuE2 scores through Modal.
- [x] 1.2 Stage generated melody Clips through Producer and configure opt-in access.
- [x] 1.3 Verify the provider contract, draft staging, and application build.
- [x] 1.4 Recover transient Modal result retrieval failures without submitting duplicate generation and verify recovery.
- [x] 1.5 Expose full-song rendering through Producer and verify audio placement and playback media.
- [x] 1.6 Preserve native ABC and its musical structure across the Modal response, versioned import and timeline.
- [x] 1.7 Verify the real EDM score and the deployed Producer path.
- [x] 1.8 Prioritize YuE2 for arrangement and split imported melodies into reusable bar Clips.
- [x] 1.9 Verify a live C-pop plan against the imported notes and export a Demotif-only audio preview.
- [x] 1.10 Default to YuE2 Render and import the corresponding editable ABC and stereo mix together.
- [x] 1.11 Verify the default arrangement through a real Producer request and retain explicit Plan-only routing.

The live L40S test generated both melody Clips, applied one draft revision, and removed both with one undo. Modal reported 8.4 seconds of score execution. The production build and standard test suite passed.

The EDM reference restored 96 bars, 8 sections, 95 chord events, and both note voices. A separate parser fixture verified expanded rests, ties, meter changes, and modulation. The deployed Producer integration imported the enriched result and undid it in one revision. Desktop and narrow layouts displayed the imported harmony.

The C-pop run called only score planning. The imported placements matched all 83 source notes and 22 chord events, and the browser exported the synthesized Plan. The EDM fixture produced 101 placements sharing 31 sources.

A live Producer composition request called Render and published one audible stereo track and two muted editable melody tracks from its ABC. One undo removed the arrangement. A separate explicit Plan-only request added editable note tracks without an audio track.
