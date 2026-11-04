# Producer arrangement workflow evaluation

Date: 2026-11-04. Local Next.js app, configured real Producer model, browser instruments, OpenCpop native PyTorch Demo voice (Chinese, non-commercial).

## Scope and method

Exercise the installed Producer through the same `/api/projects/:id/producer/runs` and proposal-application endpoints used by the UI. The orchestration agent applies authorized proposals and explicitly saves drafts; it does not substitute hand-authored note arrays for Producer composition. Test browser export by reopening a saved project. Separate provider readiness flags, mocked test coverage, successful live tool calls, and human listening feedback.

## Initial short-form experiment

The Producer created a 156 BPM, eight-bar, five-track arrangement (drums, bass, arpeggio, chords, vocal), using 19 accepted commands. It called `inspect_project`, `list_sounds`, `list_singing_voices`, and `propose_edits`. Two invalid tool inputs were corrected by the model before acceptance. After application it called `render_vocal` and `vocal_status`; native audio became ready, was explicitly saved and remained available on reopen. Browser mix export produced 12.30 seconds of audio, with a measured peak of -0.72 dBFS and RMS of -13.61 dBFS. These measurements establish a working export, not musical quality.

User listening feedback: the result was a fragment rather than a complete song, and individual vocal syllables were too short to understand. This supersedes the initial acceptance of the mechanical workflow as a sufficient musical deliverable.

## Confirmed issues and corrections

| Finding | Evidence and consequence | Correction or follow-up |
| --- | --- | --- |
| Missing accepted version in model context | `inspect_project` returned only the document. The model guessed many versions for `render_vocal`, producing conflicts | Supply project ID and accepted version in inspection/proposal context and the initial prompt. Return structured version conflicts and tell the model to stop guessing. Regression tests added |
| Lyric-only conversation was omitted from future context | History selected only applied edit runs; pure lyric planning has no commands to apply | Include completed runs with no commands alongside applied proposals. A regression verifies lyric planning survives into an arrangement request |
| Fast syllables impaired intelligibility | Listening feedback on the short demo at 156 BPM | Write lyrics first; allocate phrase time before notes. For this song, use roughly 1.75–2 beats per character and longer endings, with breathing gaps between lines. This is a song-specific arrangement decision, not a universal validator limit |
| A short loop was mistaken for a complete song | Initial eight-bar arrangement had no introduction or ending | Specify the full section map and target duration before source creation and clip placement |
| Typed command vocabulary confused the model | Invalid `clip.kind` and other tool inputs required self-correction | Explain source kinds versus clip kinds in the workflow and keep schema validation. Document actual source/track IDs between stages |
| External sound generation did not complete | A real `process_audio(mode=sound, duration_seconds=1)` call failed before an upstream task ID was recorded | Capability flags currently indicate configuration/local dependencies, not provider health. Music, speech and separation were not proven by this sound test. Do not change takes to retry an unknown submission |
| Audio job error hides the failure stage | Stored failure is a generic processing-stopped message | Preserve safe error/stage metadata in a future provider diagnostics change; do not claim a specific upstream cause from the generic message |
| Producer has no listening/export/save tools | Successful composition still needed orchestration for approval, save, native render completion and browser export | A future workflow skill must explicitly orchestrate these boundaries rather than claim the model saved or listened |
| Long-song fit cannot show the entire arrangement | At the minimum 29% zoom, the 96-bar project still needs horizontal scrolling | Allow a true overview scale with readable adaptive ruler ticks in a separate UI fix; a workflow must not claim Fit shows the complete song |
| Saved project reopen starts a new draft without Producer conversation | Reopened music and derived audio persisted, but the conversation panel was empty | Keep musical intent/lyrics in project data and a durable workflow artifact; decide separately whether draft conversation history should transfer |
| Long runs lose validated staging on timeout | A full-source creation run reached its ten-minute deadline after successful staging events, then finished failed with no retained commands | Split stages into smaller accepted/saved batches. Durable partial-proposal recovery remains a follow-up; never label a timed-out proposal applied |
| Repeated full-document tool acknowledgements enlarge context | Every successful `propose_edits` returned all notes again | Return IDs, counts and project summary after staging; exact notes remain available through `inspect_project`. Regression verifies summaries do not echo note arrays |
| Removing tracks leaves unused sources | Track removal does not remove shared sources, and the current command vocabulary has no `source.remove` | Reuse IDs deliberately and report unused material; do not make a future skill discard sources implicitly. Consider an explicit unused-source cleanup command separately |
| Explicit note JSON makes large requests expensive | Composition emits every note through the command schema and each run has a bounded tool-step budget | Stage lyrics, source creation, placement, vocals and rendering separately. Consider tested motif/pattern helpers later; do not assume code execution or automatic clip looping exists |

## Full-song workflow under test

Working title: **深夜信号**. Target: 96 bars, 156 BPM, 4/4, approximately 147.7 seconds before effect tails.

| Section | Beat range | Bars | Vocal intent |
| --- | --- | --- | --- |
| Intro | 0–32 | 8 | Instrumental buildup |
| Verse 1 | 32–96 | 16 | Four lyric lines, low/mid register |
| Prechorus | 96–128 | 8 | Two lines and rising tension |
| Chorus | 128–192 | 16 | Four clear hook lines |
| Interlude | 192–224 | 8 | Instrumental lead |
| Verse 2 | 224–288 | 16 | New lyrics, slightly fuller accompaniment |
| Final Chorus | 288–352 | 16 | Reused hook, changed closing line |
| Outro | 352–384 | 8 | Short closing phrase and instrumental release |

The initial saved short demo is retained. A separate saved working project holds the full-song experiment. The full-song trial finished successfully after the long-run failure was replaced with smaller stages. All musical note content came from actual Producer proposals. The orchestrator applied and saved eight score batches (101 commands total); it also queued already accepted local vocal sources while the remaining sections were being composed. The final Producer render/status pass reused those current results rather than creating duplicate work.

Verified final result:

- 6 tracks, 58 clip placements, 12 active sources, 400 active notes, 96 contiguous bars ending at beat 384.
- 149 sung notes across 6 vocal sources and 19 compiled phrases. Minimum main syllable duration 1.75 beats (about 0.673 seconds); the outro minimum is 2.25 beats. No missing lyric assignments or source-window overrun was found.
- All six vocal sources were current and ready, explicitly saved, cloned into a reopened editing draft, and exported through the actual browser UI.
- Saved project: `f838f5e097d149f78ee21d4cd1285be4`, named 深夜信号. The original short demo remains separate. Runtime projects/media are local ignored data, not bundled Git assets.
- Browser export: 147.692313 seconds, stereo 44.1 kHz WAV; peak -1.47 dBFS, RMS -17.08 dBFS. Section RMS: Intro -19.98, Verse 1 -16.57, Chorus -15.89, Final Chorus -15.91, Outro -24.21 dBFS. This confirms changing energy and headroom, not perceptual vocal quality.
- Reopened UI displayed Saved. Seeking to the chorus and starting playback advanced the transport without a missing/stale-vocal error; Stop returned it to zero.
- After the summary change, the first real source-batch acknowledgement was 2,360 JSON bytes and the real request retained the lyric plan. Observed source-batch polling intervals were approximately 90/40/35 seconds, placement 155 seconds, and vocal batches 120/100/85 seconds. These are local workflow timings, not isolated provider benchmarks.
- 103 Node tests, type checking and production build passed after the history/summary fixes. Lint retains existing React warnings. Earlier installed-model and Python compiler tests passed separately.

The skill is not yet installed in the Producer. The steps below are a design based on this completed trial, not a claim that a `load_skill` tool currently exists.

## Future skill boundary

The reusable skill should accept style, approximate duration, lyric language/voice, and musical constraints, then maintain a small stage manifest: project/draft/saved IDs, accepted version, lyric plan, section boundaries, source/track IDs, proposal/run IDs, current renders and export paths. It should:

1. Inspect real capabilities and select a compatible installed voice.
2. Write lyrics and a full section map before allocating syllable durations.
3. Create reusable musical sources, then place explicit clips and vary density/dynamics by section.
4. Apply reviewed proposals using the returned accepted version; persist stage checkpoints explicitly.
5. Compose monophonic vocal phrases with pronunciation and breathing space, then render accepted scores.
6. Verify every audible vocal source is current, export in the browser, and reopen the saved project.
7. Report musical listening feedback separately from structural tests and PCM measurements.

Do not hide external-provider failures, guess versions, silently change takes, equate a readiness flag with a successful request, or claim listening quality from waveform statistics. Do not force Japanese lyrics onto the currently installed Chinese-only voice. Full-song structure, source reuse and syllable budgets should be configurable musical choices, not hard-coded requirements for every genre.


## Live tool audit

| Tool / operation | Result |
| --- | --- |
| `inspect_project` | Passed; exact source document remains inspectable and accepted version is now provided |
| `list_sounds` | Passed with the installed instrument/drum catalog |
| `propose_edits` | Passed real composition, source reuse, sections, clips, gains and fades; validation retained |
| `list_singing_voices` | Passed; only the installed Chinese Demo voice was selected |
| `render_vocal` / `vocal_status` | Passed real native rendering, queued/running/ready states, content-matching cache reuse and saved-asset reopen |
| `process_audio` sound mode | Live failure before an upstream task ID was recorded; failure cause is obscured by generic diagnostics |
| Music/speech/separation modes | Present in the tool schema; not verified by this trial, and not needed to make the editable song |
| Transcription | Not ready in this local installation; optional analysis dependencies are absent |
| Save / export / listening | No Producer tool; explicit external orchestration and browser UI were required. PCM measurements do not replace listening review |

## Lyrics used in the full-song trial

### Verse 1

深夜三点敲着键盘  
一串心事没有答案  
霓虹在窗外闪又闪  
我把孤独打包上传

### Prechorus

越黑越亮的心愿  
总有一天会被听见

### Chorus

心跳点亮整条街巷  
我把信号送去远方  
你若听见轻声回响  
我们就同频到天亮

### Verse 2

末班车开过老车站  
手里咖啡凉了一半  
楼上有人睡得很甜  
我的声音飘向天边

### Final Chorus

心跳点亮整条街巷  
我把信号送去远方  
你若听见轻声回响  
就让我们唱到天亮

### Outro

信号还在回响
