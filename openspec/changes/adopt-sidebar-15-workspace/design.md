# Design

## Context

See proposal.md for motivation. AppShell currently composes sidebar-07 and a scrolling content wrapper. StudioPage owns ProducerPanel alongside Arrangement; ProducerPanel hardcodes 340px width. ProjectsPage uses a fixed 320px form column. Existing components use Base UI with base-nova; preserve that primitive family.

## Goals / Non-Goals

Goals: derive the shell from official sidebar-15, keep the arrangement viewport usable, and preserve existing workflows.
Non-goals: implement DAW audio features or redesign the official visual system. Panel resizing is a later enhancement, not required for the initial block adoption.

## Decisions

1. Retrieve the official sidebar-15 source for the installed Base UI/base-nova style during implementation. Record source and adaptation notes in docs/architecture.md. Retain the block hierarchy, default tokens, spacing, header, and sidebar behavior. Avoid replacing installed primitives with Radix variants or blindly overwriting shared files. Alternative: extending sidebar-07 leaves a custom shell instead of the selected block.
2. Introduce sidebar-left.tsx and sidebar-right.tsx from that block. Adapt left navigation to Projects and existing server-backed projects. Replace calendar/demo content with the existing Producer on studio routes. Show an explanatory empty state on the project index. Unimplemented library entries must be clearly labelled and disabled rather than fake links. No fictional account or team data remains.
3. AppShell accepts a right-panel content slot. StudioPage supplies ProducerPanel using its current project and update callback; remove its duplicate central rendering. ProducerPanel becomes width-neutral and fills its sidebar. Preserve message state while toggling the panel. Expose a right-panel trigger and a Sheet on narrow screens where the block hides the desktop sidebar. Keep center arrangement scrolling contained; retain browser-owned transport state.
4. Keep the project index within the new shell; use available-content-width wrapping or a stacked layout to avoid narrow project tiles. Retain standard Card/Input/Button appearances. Do not introduce a dashboard statistics page.

## Risks / Trade-offs

- Official preview may use a different primitive family -> select the Base UI style variant and verify generated props against installed components.
- Two sidebars reduce arrangement width -> retain official left collapse behavior and provide accessible right-panel visibility controls.
- Moving Producer can reset local messages -> keep its mounted component identity stable across desktop visibility toggles.
- Legacy purple theme can differ from official preview -> use the official neutral theme tokens for the shell; retain waveform/playhead semantic tokens needed by the timeline. Validate contrast and sidebar tokens.

## Migration Plan

Modify frontend/src/components/app-shell.tsx and add sidebar-left.tsx/sidebar-right.tsx; adapt or retire unused demo navigation files only after checking imports. Update frontend/src/features/studio/studio-page.tsx, producer-panel.tsx, frontend/src/features/projects/projects-page.tsx, and frontend/src/index.css where necessary. Preserve existing API callbacks and stores. No backend, hosted adapter, dependency, or data migration is planned. Rollback consists of restoring these presentation files.
