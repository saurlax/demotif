## Context

See proposal.md for motivation and the explicit deferral. Current code already has browser playback, clip preview and export in `frontend/src/audio/audio.ts`, transport state in `stores/studio.ts`, and `features/studio/use-audio-session.ts`. The shared shadcn UI is customized through `index.css`, `components/ui/`, and `components/theme-provider.tsx`; `studio-theme.css` adds editing-specific treatment. No adaptive atmosphere or genre analysis exists. The generic OpenSpec config predates several of these runtime capabilities; this design follows the inspected implementation rather than assuming a missing audio engine.

## Goals / Non-Goals

**Goals:** a removable studio-only visual layer, an honest analysis-to-profile contract, optional background shaders and audio-clock-synchronized motion with bounded overhead.

**Non-Goals:** implementing this proposal now, changing audio output or command history, replacing the shared UI, or using playback as a trigger for paid model/generation requests.

## Decisions

### 1. Keep appearance independent of musical state

Add future `features/studio/atmosphere/` components and mount the layer through the studio branch of `components/app-shell.tsx`. Render behind musical content with no pointer events. Store per-project Auto/manual/Off appearance preferences separately from the musical document. Do not create ProducerCommands or revisions for appearance. This avoids turning visual exploration into an edit or breaking locks/undo. Changing the entire app theme by inferred genre is rejected: home, global library and editing controls keep the shared design system.

### 2. Use real features with conservative, optional classification

Add a read-only browser analysis adapter for bounded audio windows: loudness envelope, bass/high-frequency energy, onset density, spectral shape and dynamic range. Combine these with explicit arranged instruments and project tempo; tempo or instrument names alone cannot establish an audio genre.

Use an optional bounded server analysis adapter backed by the configured producer model, with a structured result: profile (`neutral`, `classical`, `electronic`), confidence, evidence source, short reason, and project-version/feature-digest identity. A future `api/routes/atmosphere.py` and `services/atmosphere.py` own this boundary. Send aggregate features and arrangement summaries only, never credentials, raw audio, arbitrary URLs, or unrelated project data. The existing server model route is reused; the audio graph never imports a model SDK.

One explicit Analyze action permits one in-flight request; cache by project version, feature digest and analysis version, with no automatic paid retry. Auto uses a matching cached result only at confidence >= 0.75. Otherwise use Neutral and state that evidence is insufficient. Missing credentials, timeouts or unsupported audio leave manual profiles available. Pure BPM heuristics, fabricated AI labels and analysing every animation frame are rejected.

### 3. Synchronize from the playback clock without changing the graph

Expose optional read-only analysis/clock observations from `audio/audio.ts`, consumed alongside `use-audio-session.ts`. Measure actual audible output after routing/effects; silence and mute/solo must be reflected. Offline export has no atmosphere processing. Derive beat phase from the same audio position used by transport/clip loops, including scheduled starts, seeking and loop phase. Use CSS variables or canvas uniforms for visual frames rather than rerendering the React tree per frame.

### 4. Make shaders optional and nonessential

Implement a small bounded WebGL background layer with static CSS fallback. Neutral is restrained; Classical uses softer warm light and slow, low-amplitude response; Electronic uses richer spatial color and energy-driven lighting. Do not move musical content or animate text/controls to the beat. Cap at 30fps on desktop and 15fps on constrained/mobile devices, cap device-pixel ratio at 1.5, and release resources on project departure/context loss. Unsupported WebGL immediately falls back without a blocking error.

### 5. Treat reduced motion and editing clarity as first-class controls

Offer Auto, manual profiles, Off, and motion intensity within an existing studio settings popover, not a permanent sidebar. Respect OS reduced-motion preference by default and permit effects to be turned off. Stop visual frame work on pause, hidden document, and unmount. Preserve text contrast, keyboard focus, note/clip coordinates, 3px note previews and pointer gestures. Measure performance with active editing, not only an empty scene.

## Risks / Trade-offs

- Genre ambiguity or model overconfidence → display provenance, apply the confidence gate, validate with mixed/silent fixtures, and keep manual override.
- GPU or analysis contention with audio → bounded windows, worker analysis for heavy work, conservative frame/DPR budgets, automatic static fallback; never wait for analysis before playback/recording.
- Flicker and visual fatigue → no strobing, bounded luminance changes, reduced-motion/static defaults and Off.
- Stale results after edits or project switches → version/digest checks and cleanup; discard stale classification rather than changing the current project atmosphere.
- Analysis service availability/cost → explicit requests, one in flight, caching, bounded timeout, no automatic paid retries; manual effects remain local.

## Migration Plan

This change is planning-only. A later implementation starts opt-in, keeps the current shared UI as Neutral/Off, and requires no musical-document or database migration. A hosted deployment can replace the analysis adapter without moving audio scheduling out of the browser. Rollback unmounts the atmosphere layer and disables its optional analysis route; projects and media remain valid.
