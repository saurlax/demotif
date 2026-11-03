# Proposal

## Why

Demotif needs an editor workspace with persistent navigation, arrangement, and AI assistance. The current sidebar-07 shell retains unrelated demo navigation and places a custom fixed-width Producer inside the main content.

## What Changes

- Adopt official shadcn sidebar-15 as the shell source, retaining its visual structure and default styles.
- Replace sample navigation with real project navigation and clearly labelled material-library placeholders.
- Mount the existing Producer in the right sidebar on studio routes and keep the arrangement in the center.
- Preserve project creation, commands, locking, undo, and Producer application behavior.
- Verify narrow layouts and remove the project-card squeeze caused by the current fixed-column layout.

## Capabilities

### New Capabilities

- `studio-workspace`: Official-block-based workspace shell, route-aware navigation, and independently usable editor panels.

### Modified Capabilities

None.

## Impact

Touches frontend presentation at the browser UI boundary only. Server model, browser audio timing, provider, and storage adapter contracts remain unchanged. Main files: frontend/src/components/app-shell.tsx, sidebar components, features/projects/projects-page.tsx, features/studio/studio-page.tsx, and producer-panel.tsx.

Non-goals: audio engine, clip editing features, synthesis, export, real agent integration, and a custom visual redesign. No hosted adapter migration or new backend API is required.
