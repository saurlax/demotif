# Tasks

## 1. Official workspace shell

- [x] 1.1 Retrieve official sidebar-15 for the existing Base UI/base-nova setup, adapt AppShell and left/right sidebar files, retain official default presentation, and record source/adaptations in docs/architecture.md; verify hierarchy and desktop appearance against the official block and run npm run build in frontend.
- [x] 1.2 Replace sample navigation/account/calendar content with actual project links and labelled unavailable library features; verify project-index navigation, existing-project navigation, and absence of demo content in the browser.

## 2. Studio and project integration

- [x] 2.1 Move the existing Producer into the right sidebar, preserve conversation while toggling visibility, and provide labelled narrow-screen access; verify messaging, dismiss/reopen behavior, proposal application, and readable arrangement at desktop and narrow widths.
- [x] 2.2 Adapt project-index form and list to available content width using standard component styles; verify creation and readable project cards at wide and narrow widths, including the current in-app browser width.

## 3. Integration verification

- [x] 3.1 Run frontend npm run build and backend uv run pytest, then manually verify existing track selection, locking, undo, and transport state across sidebar toggles; capture the final studio screenshot and record actual results in the change directory.
