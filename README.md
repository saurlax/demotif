<h1 align="center">Demotif</h1>

<p align="center">An AI music creation workspace.</p>

**Compose through conversation, humming, and precise editing.**

Demotif is a browser-based workspace for developing musical ideas with an AI producer. Start with a melody, a lyric, or a recording, then shape the arrangement and vocal performance through an editable project. Keep the parts you like and refine the rest.

> Early development. This repository currently contains the project overview. The workflow and capabilities below describe the planned scope; a runnable application is not yet available.

## Create with an AI producer

- **Speak and sing.** Describe a change or sing a phrase to express a musical idea directly.
- **Work on a phrase.** Revise a melody, lyric, or instrument part while preserving approved sections.
- **Shape the performance.** Develop vocals from recordings, MIDI, and lyrics, with support for an authorized personal voice.
- **Stay in control.** Inspect edits, compare versions, and undo changes within the same project.

## From an idea to a track

1. Record a short melody or bring existing lyrics and audio.
2. Develop an arrangement with the AI producer.
3. Listen, select a phrase, and describe or sing the next revision.
4. Refine notes, timing, tracks, and vocal expression in the browser.
5. Save the project and export the result.

## Project architecture

| Component | Responsibility |
| --- | --- |
| Browser studio | Audio capture, multitrack playback, MIDI editing, and project interaction |
| Producer agent | Conversational guidance and structured editing tools |
| Audio services | Transcription, melody extraction, generation, vocal synthesis, and rendering |
| Project storage | Recordings, generated assets, project state, and revision history |

The project model is the source of truth. Agent actions operate on explicit tracks and clips, respect locked sections, and produce reversible edits. Generation providers are separate from editing and playback.

## Development

```bash
git clone https://github.com/saurlax/demotif.git
cd demotif
```

Implementation, setup instructions, and deployment documentation will be added as components become available.
