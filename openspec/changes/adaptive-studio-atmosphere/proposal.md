## Why

A music workspace can reflect the character and energy of the music without compromising editing clarity. A later iteration should add studio-only background shaders and musical motion on top of the shared UI system; the current priority is the shared UI redesign, not adaptive effects.

## What Changes

- **Deferred proposal only:** implementation requires a separate request; all implementation tasks remain unchecked.
- Add optional neutral, classical, and electronic/club atmosphere profiles, with automatic analysis, manual override, and Off.
- Drive background shaders and restrained rhythmic lighting from actual playback and audio features. Classical material receives quieter treatment; electronic material can use a more spatial, dance-floor-like background.
- Report analysis provenance and uncertainty. Unanalysed or ambiguous music retains the neutral profile rather than receiving an invented genre label.
- Keep home and global library pages restrained within the same customized shadcn UI system. Adaptive effects apply only inside projects.
- Include reduced-motion behavior, a static fallback, and bounded GPU/CPU work.

## Capabilities

### New Capabilities

- `studio-atmosphere`: Optional project-workspace atmospheres, reliable analysis/override behavior, shader rendering, playback synchronization, accessibility, and lifecycle limits.

### Modified Capabilities

None. The main specs directory currently contains no implemented capability specs to modify.

## Impact

- **Browser audio boundary:** read-only analysis/clock taps in `frontend/src/audio/audio.ts` and consumers of `use-audio-session.ts`; audio scheduling and export must remain unchanged.
- **UI boundary:** future atmosphere components under `frontend/src/features/studio/`, scoped through `app-shell.tsx` and `studio-theme.css`, building on shared tokens in `index.css`.
- **Server/provider boundary:** any later genre model is behind an explicit analysis adapter, never inside the audio graph; credentials remain server-only. No new classifier/provider is enabled by this proposal; a later optional adapter can reuse the configured model route.
- **Server model:** no musical commands or revisions for visual preferences. The project document, version checks, locks, and append-only undo remain authoritative.
- **Non-goals:** implementing shaders or style adaptation now; another general UI rewrite; fabricated meters; moving note/clip geometry with effects; modifying sound; editing projects to match a predicted genre; automatic paid generation or media uploads.
