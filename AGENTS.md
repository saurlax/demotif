# Demotif — agent guide

Demotif is a browser-based AI music workspace: a conversational producer edits an explicit project model while the
browser owns real-time audio.

## Layout

- `frontend/` — Next.js 16 App Router + React + TypeScript + Tailwind v4 + shadcn/Base UI; serves UI and Node API.
- `frontend/src/shared/schema.ts` — shared runtime Zod schemas; UI types derive from them.
- `frontend/src/server/` — SQLite, typed commands/history, drafts, media, AI SDK producer and audio jobs.
- `frontend/src/audio/` — browser DSP, Web Audio graph and Workers.
- `resources/` — built-in sound catalog/media and licenses.
- `analysis/` — optional Python 3.13/librosa transcription subprocess; no Python HTTP server.
- `data/` — ignored local database, media and example packs.
- `openspec/` — existing specs and future proposals. `docs/architecture.md` describes current runtime boundaries.

## Commands

```bash
npm ci --prefix frontend
npm run dev                        # Next.js UI + API, port 5173
npm run build
npm start
npm test                           # browser audio + Node service tests
npm run typecheck
npm --prefix frontend run lint
uv sync --project analysis         # optional offline transcription only
uv run --project analysis pytest
npm run migrate:local              # copy legacy state; retain original files
```

## Invariants

- The project document is the source of truth. The browser never invents state the server has not accepted.
- Every edit is a typed, validated `ProducerCommand` with `expected_version`; the server enforces version checks and
  rejects edits that touch locked tracks/clips. Operations are append-only; undo writes a new version. Legacy revisions remain read-only.
- Real-time audio (transport, metronome, recording, monitoring, pitch detection) stays in the browser. Agent/network
  latency must never gate recording start.
- Generation providers are separate from editing and playback. Never couple the DAW audio graph to a provider SDK.
- Local adapters stand in for future hosted services: local filesystem ↔ object storage, SQLite ↔ Postgres,
  local AI SDK producer ↔ hosted agent. The app has no Python API or agent harness dependency.

## OpenSpec workflow

Use the `openspec-*` skills in `.agents/skills/`. For non-trivial work, propose a change first:

```bash
openspec list
openspec validate <change>
openspec archive <change>
```

Keep proposals small, state which boundary they touch (browser audio / server model / provider), and name the
invariants above when they apply.

## Implementation scope

- Keep the initial migration direct. Do not add bespoke origin/host allowlists or arbitrary new limits; preserve existing command validation, version checks, locks, and save semantics.

## Style

- TypeScript: strict, `erasableSyntaxOnly` (no parameter properties / enums), path alias `@/`.
- Node services own SQLite transactions. Runtime-validate all command/provider boundaries with shared Zod schemas.
- Python is limited to the optional analysis subprocess; retain bounded input/output and public type hints.
- Do not add dependencies that are not used by the current change.

## Interface rules

- Render the brand wordmark as **Dem∅tif**, using the empty-set symbol `∅` (U+2205) for the `o`. Keep the accessible
  product name **Demotif** and existing package names, routes, and API identifiers. The browser document title is
  plain **Demotif**, with an uppercase D and without the empty-set symbol. Reuse the shared outlined SVG
  wordmark component, not live text or a separate generic music icon. Its Geist 500 letterforms and crossed-o symbol
  share one geometry; regenerate assets with `uv run scripts/generate_brand.py`. Preserve the aspect ratio and
  monochrome treatment; navigation displays it at 18px high. Font licensing is retained in `frontend/branding/OFL.txt`.
- Customize the shared shadcn/Base UI tokens and components directly, including the home page, global library,
  studio, buttons, inputs, cards, and dialogs. Use Geist typography, neutral charcoal/silver surfaces, amber primary actions,
  mint playback/status feedback, and readable track/source colors. Take layout cues from DJ decks and samplers:
  clear control groups, precise scales, compact pads, and thin separators. Use compact seven-segment time/tempo readouts and LED state indicators, with restrained amber/mint glow
  on real readouts and active states. Keep ordinary labels in Geist. Avoid beveled controls, gradient
  toolbars, inset shadows, ambient glows, and hover lifts; color and outlines communicate state. Do not add
  decorative turntables or fake meters. Home and library layouts stay restrained
  within this same visual system; restrained does not mean leaving their old styling unchanged.
  Keep all colors in the shared light/dark tokens in `src/index.css`: amber for actions/selection, mint for
  playback and ready states, muted musical hues for track/note data. Reuse track tokens in clip/library/drag previews;
  preserve stored custom colors. Home project icons use the brand color rather than arbitrary alternating accents.
  Keep musical editing geometry stable during interaction animations; honor reduced motion.
  Side panels enter and exit horizontally from their own edge (Library left, Producer right). Animate
  both directions and retain closing content until exit finishes; never use bottom-up motion for sidebars.
  Bottom clip editors and mixer panels slide up to open and down to close, with height transitions that
  return space to the arrangement. Retain closing content until exit finishes, disable interaction during
  exit, and stop clip loops/audition immediately instead of waiting for animation unmount.
- Adaptive genre themes, background shaders, and beat-reactive ambient effects are deferred to their OpenSpec
  proposal. Do not implement them as part of the current studio UI polish.
- Primary text, control labels, actions, and conversation content are at least **14px**. Secondary metadata, timeline
  ticks, and piano/drum labels are at least **12px**. Do not introduce 9px/10px/11px text or shrink text to fit a panel.
- Instrument, mixer, effect, and drum settings use parameter names at least **14px** and editable numeric values at
  least **16px**. Labels wrap instead of truncating. Chart labels retain their readable size when charts scale.
- Icon buttons have a minimum **32 × 32px** hit area, with visible keyboard focus and an accessible name. Dense
  musical note/step cells follow the editor's musical zoom; they are not toolbar icon buttons.
- Do not add default descriptions, subtitles, slogans, explanatory cards, duplicate labels, decorative numbering,
  or repeated bilingual headings. A title and its controls are normally enough. Keep concise empty/loading states,
  actionable errors, units, unavailable-feature reasons, and help that changes an actual user decision.
- Accessibility-only descriptions may remain visually hidden. Do not remove accessible names or required dialog
  semantics to satisfy the no-description rule. Explain necessary constraints at the relevant control, not everywhere.
- Use the available workspace width: wrap controls, stack settings, or allow scoped scrolling when space is tight.
  Do not solve overflow by reducing font sizes, squeezing labels, nesting decorative borders, or clipping controls.
- The arrangement is the primary workspace. Library, editors, mixer, and Producer are secondary panels; closing a
  panel returns space to the arrangement. On narrow screens prioritize tracks and use drawers for secondary navigation.
- The studio fills its main region edge to edge. Do not wrap it in an outer card, rounded border, or padded inset;
  use separators between functional regions instead. Keep page/card spacing on project management pages only.
- Inside a project, the top bar shows the brand and current project name, without a Projects breadcrumb or arrow.
  The project name opens a file menu containing Open project, Save (regular drafts), Save as, and audio
  Export. Open project uses a searchable dialog; choosing a saved project performs native document navigation
  so the unsaved-change warning still applies. Keep these actions out of standalone header buttons.
  Save status and undo remain beside the project menu in the header. Playback controls, position,
  tempo and time signature live at the right of the Library / Audio / Mixer tools row below it. Tempo
  and meter default to borderless value controls; reveal the tempo input or meter picker only on activation.
  Enter/blur commits a valid tempo once, Escape cancels without writing, and keyboard focus returns to the value. Do not add a second project title bar or bottom
  transport bar. The time signature is an editable, versioned project setting. Whole-song playback
  stops at the end; looping belongs to the clip editor, without a whole-song Loop control. Wrap header controls on narrow screens.
  Omit the global project-switching sidebar. Clicking the brand returns home directly once changes are saved.
  Open examples as editing drafts, never as saved projects. Open regular projects in independent editing
  drafts; commands, uploads and Producer changes update that draft until explicit Save. Examples expose only
  Save as; regular projects expose Save and Save as, with a version check against the saved base to prevent
  cross-tab overwrites. Keep drafts out of project lists and recents; undo back to the saved checkpoint is clean.
  Use browser-native departure confirmation while accepted draft content differs from its checkpoint, while
  edits/uploads/saves are pending, or while editable fields have uncommitted values. Saving clears dirty state
  only after server acknowledgement; failed/conflicting saves keep the draft and prompt protection intact.
  Do not warn on every visit. Track queued and concurrent work until all have completed.
  Internal document navigation uses one shared unsaved-changes dialog before leaving a dirty draft, since embedded
  browsers may silently cancel beforeunload and native confirm without showing their dialogs. Cancel retains the workspace; confirmation removes
  the beforeunload handler for that departure to prevent a duplicate prompt. Refresh/tab closure retain beforeunload.
  Do not stack another confirmation on this dialog.
- Use **Clip / Clips** consistently for musical fragments in the interface, including creation, track counts,
  editors, and saved library items. Keep existing internal protocol identifiers compatible with stored projects.
- Audio generation, vocal separation, and audio-to-notes conversion are Producer actions. Do not add a standalone
  Audio tools panel or generation form; retain audio import and the agent tools that propose results for approval.
- Creation and one-off configuration forms (such as new project name and tempo) open in a dialog from an explicit
  action. Do not place these forms directly on list, overview, or workspace pages by default. Keep inline controls
  for direct editing of existing content, such as transport, mixer, and clip parameters.
- The Producer sidebar and its toggle only appear inside an open project. Project management pages have no AI
  sidebar, empty Producer placeholder, or reserved space for it.
- Global Library navigation opens project-independent built-in audio/instrument browsing and audition pages.
  Never silently choose the first project or require a project just to browse built-in materials. Project clips
  remain in the studio library; any future add-to-project action must explicitly select its destination.
- Editing surfaces (arrangement, piano roll, drum grid, waveforms, and clip library) disable native text selection
  and native dragging of clip/note content; editable inputs and textareas retain text selection. Pointer gestures
  cancel cleanly on Escape, pointer cancellation, window blur, and unmount.
- Piano rolls use recognizable black/white keys, alternating pitch lanes, stronger bar/beat lines and quieter
  subdivisions. Clip note previews use consistent 3px screen-space strokes, independent of pitch and zoom.
- Piano/drum keys support press-and-glide audition across pitches with an active-key highlight. Re-entering the
  same held key does not retrigger until the pointer leaves it. Release, cancellation, lost capture, window blur,
  hidden document, and editor closure stop audition (including pending sample loads); audition never edits notes.
- Keep project-copy, project-JSON export, and add-Track buttons out of the studio toolbars. Timeline editing
  actions stay left; zoom out, the current percentage, zoom in, fit, and follow controls stay right. The initial
  timeline scale is 100%; the displayed percentage follows actual zoom and fit changes. The ruler supports
  press-and-drag seeking, including edge scrolling. Follow keeps the playhead centered in the visible musical
  area (excluding track headers), suspends during manual gestures, and resumes afterward. The top transport
  shows elapsed minutes, seconds and hundredths instead of bar/beat numbers. Render saved song sections
  above the bar-number ruler, preserving their names, colors, start beats and lengths as the timeline zooms
  and scrolls; projects without sections keep the compact ruler. Audio waveform previews use
  display-width sampling and constant screen-space strokes; never stretch a fixed set of bars into thick blocks.
- Generic clip creation lives at the plus button beside the studio library search. Open a dialog to choose
  instrument/drum/audio type, sound or sample, name, and musical length. Do not duplicate this with a top-level
  Clip button, Notes/Drums footer buttons, or a save-to-library toolbar icon. Keep clip placement and drag-back
  library behavior distinct from opening the library.
- Clip editors reserve their width for musical content, without a permanent parameter sidebar. Clicking a piano
  note opens an anchored parameter popover; sound/synth/sampler and clip settings open from the toolbar in a dialog.
  Prefer sliders for continuous parameters, preserve keyboard control and readable values, and persist once on
  release instead of issuing a command for every intermediate slider position. Dragging/resizing notes must not
  open the inspector; popup shortcuts must not also edit notes or close the underlying editor.
- Studio library clips and drag previews share the same compact card content: name, clip color, and real
  note/waveform preview for the saved source range. Library drags use the same pointer-driven floating
  card and sway animation as arrangement moves through the shared `ClipDragPreview` component, including
  color resolution, sizing, velocity-based tilt and idle settling. Keep only placement/move semantics separate.
  Both origins have a faded origin and snapped placement preview; do not
  use the browser-native drag ghost. Do not reduce library clips to icon-and-name rows.
- Clip moves show a lifted preview with the real clip content, a faded source and a snapped destination; resize
  previews follow the edited edge. Preview state never changes the accepted project document. Respect reduced motion.
- Show actual state and data. Do not draw fabricated notes/waveforms, decorative meters, or effects that do not change
  sound. Keep engineering/provider implementation details out of normal user flows unless needed to resolve a problem.
- Verify UI edits at desktop and narrow widths, including long names, numeric inputs, scrolling, and keyboard focus;
  run the frontend build. Screenshots and test outputs are temporary artifacts, not project source files.

- Audio clip editors use a fixed musical time scale with a bar ruler and horizontal scrolling, matching note
  editors. Never squeeze an entire long recording into the available editor width. Waveform density follows
  its rendered width, strokes stay in screen pixels, and the loop cursor uses the same time-to-pixel mapping.
