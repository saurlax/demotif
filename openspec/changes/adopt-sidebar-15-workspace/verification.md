# Verification

- Frontend npm run build: passed. Vite reports a bundle-size advisory (541 kB JS).
- Frontend npm run lint: no errors; six existing warnings in shared UI components/use-mobile, none in the new workspace/session files.
- Backend uv run pytest: 6 passed.
- Official source retrieved: https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json; neutral tokens from https://ui.shadcn.com/r/themes/neutral.json. No dependency installation or backend modification.
- Browser checked at 1440x900, normal 789px in-app width, and 390x844. Wide view shows the official left/inset/right hierarchy. Narrow view exposes Producer in a dismissible Sheet and project navigation in the standard mobile sidebar.
- Project index cards stack at narrow available widths and remain readable. Project creation and actual project navigation passed.
- Created local QA project Sidebar layout check (d091560bb2424704afcdc60af587cb9e). Producer offered a drum track, application created it at v2, lock advanced to v3, undo restored unlocked at v4. Existing project documents were not edited.
- Producer conversation and draft survive panel close/reopen; conversation also remained when switching between desktop and narrow layouts. Applied marker remains visible.
- Playhead continued advancing while left/right sidebars toggled; Stop reset it. Existing clip selection displayed its selection outline.
- Browser viewport restored to its original size and existing Midnight sketch project left open.
- This is a layout adaptation. Existing recording/export/audio-engine placeholders and disabled library entries remain explicitly unavailable.
