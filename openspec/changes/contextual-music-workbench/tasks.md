# Tasks

## 1. Provider capabilities and configuration

- [x] 1.1 Add shared categorized audio capability/request/result schemas and the server provider registry; use OpenRouter for remote generation and verify unsupported-category rejection tests.
- [x] 1.2 Add server-only OpenRouter configuration and placeholder documentation, reuse the supplied credential in ignored project-local configuration without disturbing existing settings, and verify sanitized API/error output and secret exclusion from tracked files and client payloads.
- [x] 1.3 Implement independent readiness and sanitized model/voice discovery, including OpenRouter's dedicated speech catalog; test music availability without Producer language-model configuration and actionable unavailable reasons.
- [x] 1.4 Update README and architecture documentation with the five capability categories, first supported providers, secret configuration and the distinction between Sound audio Clips, sound effects, speech and score-driven singing.

## 2. OpenRouter jobs and media

- [x] 2.1 Verify the documented Lyria request/response contract and implement Pro/Clip Preview generation decoding, provider-specific duration validation and sanitized failures; test complete, malformed, truncated and text-only responses using credential-free fixtures.
- [x] 2.2 Implement the OpenRouter speech adapter for verified ElevenLabs, MiniMax, Google and Fish speech models with supported voice/format validation and documented PCM metadata; test MP3/PCM decoding and rejection of unsupported options.
- [x] 2.3 Enable Seed non-speech sound effects if its documented adapter contract is verified, otherwise report sound effects unavailable through OpenRouter; test category discovery and non-speech request handling.
- [x] 2.4 Integrate adapters with persistent audio jobs and existing media/S3 publication, recording model, captured inputs, actual duration and uncertainty; test deduplication, restart, cancellation, late results and no automatic paid resubmission.
- [ ] 2.5 Run bounded live music and speech smoke generations using the configured key, audition and inspect published audio, and record model/format outcomes without credentials in temporary artifacts; verify every enabled sound-effects adapter similarly and document recovery and supported limits.

## 3. Piano-roll group selection and edits

- [x] 3.1 Add pure marquee and shared group-transform helpers with tests for unequal note durations, grid snapping, import preservation, pitch/time limits and vocal metadata/constraint preservation.
- [x] 3.2 Implement deferred empty-click creation, left-drag marquee, Shift additive/toggle selection and visible selected IDs in the piano roll; manually verify scrolling, single-note modal access and no accidental creation while selecting.
- [x] 3.3 Implement group pitch/time dragging and shared-delta right-edge resizing with transient previews and one atomic versioned source update; test one-operation undo, lock/version rejection and unchanged unselected notes.
- [x] 3.4 Extend keyboard movement/deletion and selection-scoped select-all, cancel on Escape/pointer loss/blur/unmount/source changes and isolate modal shortcuts; verify at desktop/narrow widths and document group gestures beside existing editor documentation.

## 4. Shared contextual Producer lifecycle

- [x] 4.1 Move run loading, SSE subscription, submit/apply/cancel and shared draft ownership into one studio-mounted controller; verify reconnect deduplication and continuity while sidebar views mount/unmount.
- [x] 4.2 Add validated immutable Clip/location context to run and direct audio-action requests, check ownership/version/locks server-side, and test changed/deleted targets plus explicit retargeting of recoverable results.
- [x] 4.3 Support generation model/category options and direct audio actions without requiring a configured text agent; verify shared audition/review/apply controls and no duplicate submissions across floating/sidebar views.
- [x] 4.4 Include composer drafts, generation, rendering, upload and acceptance work in existing departure protection; verify cancel/confirm behavior, cross-project resets and preserved conversations, then document lifecycle behavior.

## 5. Clip conversion and location generation

- [x] 5.1 Add arrangement Clip and empty-space context actions with captured track/beat/source-window targets; verify left-background selection, right-click composer anchoring, keyboard menu access and no paid submission on menu opening.
- [x] 5.2 Implement Render as Sound using isolated browser Clip export and current singing preparation, owned upload and reviewable source/library/placement commands; verify offset/range, instrument/track processing, vocal readiness and retained original Clips.
- [x] 5.3 Implement explicit AI Sound variation through the shared composer with supported prompt/lyrics context and visible guidance limits; verify prompt-only models do not claim exact source preservation or receive unsupported reference audio.
- [x] 5.4 Extend audio analysis requests to the captured imported/generated source excerpt and produce notes on a muted new track; test offset slicing, seconds-to-beats conversion, range limits, atomic acceptance and retained original audio.
- [x] 5.5 Implement Generate sound at empty locations with captured placement/new-track proposals and actual measured duration; test locked destinations, stale versions, audition, acceptance and explicit recovery after destination deletion, and document conversion/generation semantics.

## 6. Floating composer and Producer operation cursor

- [x] 6.1 Make the project Producer sidebar controlled and closed by default; add the floating composer and shared review popover while preserving horizontal sidebar transitions, keyboard focus and arrangement width recovery; verify desktop and mobile drawer behavior.
- [x] 6.2 Add semantic target registration/resolution for arrangement Clips, tracks, editor notes and musical ranges; verify geometry after scroll/zoom/panel resize and safe fallback for offscreen/deleted targets.
- [x] 6.3 Emit validated activity events from real inspection, processing, proposal and application transitions; test target/phase correctness, historical event compatibility, cancellation/error completion and atomic multi-target application.
- [x] 6.4 Implement the distinct non-interactive Producer cursor, concise streamed text, composer relocation and restrained travel/settling motion; verify proposed versus applied feedback, unchanged musical geometry, reduced motion and no pointer interception.
- [x] 6.5 Verify long names, readable model/numeric controls, viewport clamping, context changes while typing, Stop/audition/Apply access and popup focus return at desktop and narrow widths; document floating Producer and optional history access.

## 7. Integration checks

- [x] 7.1 Run relevant audio/provider, command, vocal, storage and session regressions plus typecheck, lint and the frontend build; resolve failures attributable to this change while preserving existing uncommitted work.
- [x] 7.2 Exercise a complete draft workflow: multi-select edit, render/AI generation/analysis, contextual cursor review, Apply, undo, Save/Save as, reopen, playback and export; verify native/internal departure prompts and no provider dependency during playback of accepted audio.
- [x] 7.3 Reconcile implemented behavior and verification evidence with all four specifications, keep evaluation screenshots/audio temporary, and run strict OpenSpec validation before reporting implementation complete.


## Verification evidence

- 2026-11-07: Node/service/DSP suite: 159 passed, 3 skipped. Typecheck, frontend production build and strict OpenSpec validation passed. Lint exits successfully with existing and new advisory React warnings.
- Analysis environment installed in its ignored project virtual environment; `uv run --project analysis pytest analysis`: 2 passed. An initial unscoped pytest command also collected singing tests under the analysis interpreter and found missing singing-only pypinyin; those tests require their separate singing environment.
- Live provider checks: ElevenLabs Flash v2.5 MP3 (44.1 kHz mono, 2.41 s), MiniMax Speech 2.8 HD MP3 (32 kHz mono, 3.02 s), Gemini 3.1 Flash TTS Preview WAV (24 kHz mono, 3.64 s). A direct studio speech job also completed and entered review.
- Both Lyria models returned HTTP 403, "This model is not available in your region." No music output was generated; task 2.5 remains incomplete for this external access condition. No blind retries or alternative-provider substitution was performed.
- Browser QA used an isolated in-memory project/database and an emulated S3 transport through the actual media adapter, without changing the configured shared backend. Verified marquee, group move/resize, one-step undo, contextual menus, render/audition/apply, imported/owned audio analysis and muted result track, sidebar continuity, real result states, draft departure decisions, Save as and Saved acknowledgement.
- Desktop and 390 px layouts checked with long names and numeric controls; context anchoring stays below the selected Clip and the composer returns to its rest position after acceptance. Reduced-motion emulation reports a 0 s composer transition. Temporary screenshots and audio are under ignored data/qa.
- Scanned 39 client build files for the supplied credential: zero occurrences. The key is in ignored project-local server configuration only; shared-backend deployment and its provider configuration have not been changed.

- Final browser regression confirmed conversion creates a separate audio track, detected notes have a real preview and muted track, Save as acknowledges Saved, reopening creates an independent clean draft with all three sources, playback starts, and WAV export downloads successfully. Keyboard select-all also preserves clean saved state.

## 8. Input-only Producer refinement

- [x] 8.1 Replace floating generation/settings/review UI with a compact aligned input plus send/stop, route requests through Producer, retain draft/focus/IME handling and context positioning; verify desktop/narrow layouts and build.
- [x] 8.2 Move audio audition/review/apply into conversation sidebar and refresh agent-created jobs independently of sidebar mounting; verify retained history and no duplicate submissions.
- [x] 8.3 Capture selected Clips, editor sources and note IDs as validated references, persist them with conversation, inherit context in audio tools and let the agent select models; verify selection/context and real tool-loop tests.
- [x] 8.4 Update interface documentation, run relevant tests/typecheck/build and strict OpenSpec validation; verify current user page and temporary selection fixture with screenshots kept outside source.

- [x] 8.5 Add a sidebar-only Producer model selector with one DeepSeek Flash default preset, validate and persist per-run selection, and verify live context recognition without project edits.

### Input-only Producer verification (2026-11-07)

- 173 tests passed, 3 opt-in tests skipped; typecheck, production build and strict specification validation passed.
- User page verified at its native 921 px width and a 390 px override. Floating input is 480 px wide by default, 366 px at narrow width; textarea and send button are both 40 px high with 0 px center difference. No generation/model/review controls remain in the floating view.
- Sidebar open/close retained the shared prompt. Model selector displayed exactly one default preset, DeepSeek Flash; default model and per-run selection are validated server-side and persisted as conversation events.
- Independent draft fixture verified Clip selection and two-note additive selection update accessible references. Original saved projects were untouched; fixture screenshots remain under ignored data/qa.
- Live OpenRouter DeepSeek Flash run recognized the referenced C4 and E4 notes, completed with zero edit commands, and left the draft version unchanged. The local Producer now uses deepseek/deepseek-v4.1-flash. An initial automatic-router probe returned a regional 403; it was not retried or left as the default.
- Completed audio results/audition/Apply now live in the sidebar. Agent-run polling is independent of panel visibility and avoids duplicate pending-job polling. Existing audio publication and acceptance regressions pass; no new live audio generation was attempted without storage.

## 9. Turn-based voice chat

- [ ] 9.1 Add microphone/send/stop state switching and a compact voice-mode entry with real phase, interrupt and end controls; verify empty/typed/busy states and desktop/narrow layouts.
- [ ] 9.2 Add server-only ElevenLabs transcription and reply speech endpoints without S3 using the dedicated audio credential; validate input/output, cancellation and owned completed-run access with focused provider/API tests.
- [ ] 9.3 Add browser recording, silence detection, captured-context voice submission, spoken-reply playback and repeated turns; verify voice-activity/lifecycle behavior and teardown without recording ambient user audio.
- [ ] 9.4 Preserve transcripts, voice mode and selected-model/context metadata in sidebar history; reject stale versions and retain failed input, and verify shared run/tool behavior.
- [ ] 9.5 Update documentation with turn-based limitations and sources; run relevant tests, typecheck/build, synthetic speech/transcription checks and visible UI verification.

## 10. Direct ElevenLabs audio integration

- [x] 10.1 Add the dedicated credential, migrate the ignored local value, document six runtime variables and preserve independent LLM/Realtime configuration.
- [x] 10.2 Implement validated direct model/voice discovery and music, SFX/loop, TTS, voice conversion, speech isolation, recognition and alignment adapters with sanitized errors and cancellation.
- [x] 10.3 Route durable jobs, Producer tools and turn-based voice through ElevenLabs; preserve owned source windows, no paid replay, review/acceptance and text-only results. Remove OpenRouter batch audio adapter.
- [x] 10.4 Add credential-free provider/job/voice regression tests; run typecheck, lint and build; verify desktop/narrow result presentation.
- [x] 10.5 Run bounded synthetic live music, SFX and speech checks; report access failures and storage limitations without credentials, then validate the specification.

### ElevenLabs verification (2026-11-08)

- Direct music_v2_5 instrumental (3.03 s), explicit-lyrics vocal music (6.03 s), SFX one-shot (1 s), seamless-loop request (2 s), Chinese TTS (2.16 s), Scribe v2 transcription, voice conversion, speech isolation (6.48 s synthetic recording) and forced alignment succeeded using the project key. Original short isolation fixtures returned invalid_audio_duration; the adapter now enforces the observed 4.6 s minimum before paid submission. Missing Voices/Forced Alignment permissions were enabled by the user; subsequent checks passed. No automatic paid retries were introduced.
- Nine TTS models, two voice-conversion models and 22 accessible voices were discovered. Known music/effects/recognition endpoints are independent of speech discovery. Names accompany voice IDs for agent selection.
- 190 tests passed, 3 opt-in tests skipped. Typecheck, lint (existing warnings) and production build passed. Tests cover direct credential routing, lyrics chunks, looping, multipart input, source ranges, durable publication via isolated storage, explicit acceptance, text-only results and failed-request deduplication.
- Desktop and 390 px browser verification used mocked recognition/alignment result responses in an isolated temporary tab, without edits or paid requests. Long names/text wrap, word timings remain readable, and text results have no Apply control. Interception and viewport override were removed and the test tab closed. Screenshots and evaluation audio remain under ignored data/qa.
- Initial inspection found no active project-local storage configuration. Follow-up recovered the existing project-specific private COS/S3 configuration from the external Demotif operations cache and mapped it to the current ignored config/environment files. Object upload, read and Range checks passed. The running local API now reports music/effects ready; direct STS upload/download, byte-integrity verification and explicit placement of a previously generated ElevenLabs sample into an isolated QA draft all passed. No additional paid generation or changes to the user-opened project were made. Bucket-level HEAD returned 403 while scoped object operations succeeded; no broader permissions were requested.
- LLM credentials remain unchanged and serve language/future Realtime only. The ignored local key was renamed to DEMOTIF_ELEVENLABS_API_KEY. Tracked/unignored files and client JS bundles contain no configured secrets. The broader turn-based/Realtime UI tasks remain separately tracked; native full-duplex transport was not implemented by this provider change.

## 11. Unified contextual audio operations

- [x] 11.1 Add shared applicable context actions, selected instrument/sample reference metadata and unified default menu submission while preserving typed drafts.
- [x] 11.2 Implement the validated, owned, idempotent Producer-to-browser render bridge with cancellation, reconnect and explicit result review.
- [x] 11.3 Add owned audio reference excerpts to Eleven Music upload/conditioning with source snapshots, durable identities and no paid fallback/replay; unify result placement and analysis staging.
- [x] 11.4 Add meaningful action/reference/render/agent regression tests and run typecheck, lint, build and specification validation.
- [x] 11.5 Verify desktop/narrow context menus and a selected-context natural-language render/analysis flow, plus bounded synthetic referenced generation; keep temporary artifacts outside source.

### Contextual operations verification (2026-11-08)

- Real Producer requests in an isolated QA draft rendered the selected C4/E4 note Clip into a four-second guitar Sound, then transcribed that Sound into two editable notes with the requested guitar instrument on a muted new track. Reviewed commands preserved the original sources and Clips; only the QA draft accepted the results. The first render trial exposed duplicate model placement, corrected by returning explicit already-staged placements and guidance; the later render contained exactly four creation commands.
- Actual Music v2.5 reference upload/conditioning and S3 publication succeeded with a three-second owned synthetic excerpt and a 3.03-second output. Live validation established a ten-second upload minimum; short references now repeat for upload only while conditioning retains the original window. Upload and generation are separate paid stages; failures are retained without automatic retries or prompt-only fallback.
- Desktop (1440 x 900) and narrow (390 x 844) menus show applicable operations without clipping. Natural-language requests work with the sidebar closed; history/review remain in the sidebar. Temporary screenshots and audio remain ignored in data/qa; viewport override was reset and temporary tabs closed. The user-opened project was not modified.
- 205 tests passed, 3 opt-in tests skipped. Typecheck and production build passed; lint retained existing warnings. Regression coverage includes owned references, short-reference framing, deterministic staged identities, claims/completion, version/lock/cancellation rejection, render snapshots and an actual mocked language-model tool loop.

- [x] Floating output follow-up: show live public text/progress and retain final reply in a bounded scrolling area above the compact input. Verified initial Working state and a real Producer reply with the sidebar closed at 390 px and 1440 px; no musical edits were requested. Screenshots remain ignored under data/qa.

## 12. Direct reversible Producer workflow
- [x] 12.1 Move model selection into input footer, use waveform voice entry in both composers, render safe Markdown without assistant bubbles and remove standalone Audio results.
- [x] 12.2 Automatically commit completed new-run batches with version/lock checks, refresh browser state and provide normal undo; never replay historical runs.
- [x] 12.3 Verify automatic single application, undo and concurrent conflicts with regression tests.
- [x] 12.4 Verify desktop/narrow UI and real automatic editing/undo; run build, lint and strict specification validation.

Producer polish verification: 207 tests passed, 3 opt-in tests skipped. Typecheck/build passed and lint retained pre-existing warnings. A real request in the isolated QA draft automatically changed tempo from 120 to 121 BPM and refreshed the transport; the conversation Undo changes button restored 120 BPM. Desktop and 390 px verification confirmed Markdown lists/bold text, no assistant bubble or Audio results list, model choice in the input footer and waveform voice entry. Historical runs were not replayed. Temporary screenshots remain ignored, browser override reset and QA tab closed.
