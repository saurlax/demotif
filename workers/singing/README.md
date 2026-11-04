# Native singing worker

An isolated Python 3.11/PyTorch worker. It has no web server, project database access or ONNX dependency. The studio exposes vocal creation, lyric editing and explicit synthesis through the existing clip workflow. Next.js owns durable jobs and derived media; this process only performs inference.

## Non-commercial demo installation

The user approved non-commercial models for the local Demo. Do not distribute weights with the app or treat this profile as a commercially deployable singer. Voice and vocoder terms are separate from the Apache-licensed engine code; see NOTICE and `docs/vocal-model-screening.md`.

From the repository root:

```bash
uv sync --project workers/singing --python 3.11
mkdir -p data/models/downloads
git clone --depth 1 --branch v1.5.0 https://github.com/openvpi/DiffSinger.git data/models/diffsinger-reference
```

Obtain these exact official release archives after reviewing their terms, and place them under `data/models/downloads/`:

- `0116_female_triplet_ds1000.zip`: https://github.com/openvpi/DiffSinger/releases/tag/v1.5.0
- `nsf_hifigan_20221211.zip`: https://github.com/openvpi/vocoders/releases/tag/nsf-hifigan-v1

```bash
uv run --project workers/singing python workers/singing/prepare_demo.py
uv run --project workers/singing python workers/singing/benchmark.py \
  data/models/opencpop-native-demo/profile.json \
  --output data/models/opencpop-native-demo/results
uv run --project workers/singing python -m unittest discover -s workers/singing -p 'test_*.py'
```

Preparation extracts archives, computes weight/config/dictionary hashes and creates a local profile. The selected voice is the OpenCpop speaker only. It uses the original 44.1 kHz/128-mel/hop-512 native acoustic model and matching NSF-HiFiGAN vocoder. Explicit phoneme durations and pitch curves are supplied: this older experimental profile does not provide a modern independent duration/pitch-prediction model. Unsupported automatic controls must not be advertised by the studio.

The dependency lock isolates older reference-code requirements from the optional Python 3.13 analysis tool. The import bridge exposes the unchanged decoder registry and loads only the selected native vocoder to avoid importing unused training/PWG packages. It does not change inference math. PyTorch 2.5.1 preserves the legacy checkpoint loading behavior used by this pinned release.

## Reference CLI comparison

The CLI bridge runs the original pinned `main.py`, with the same import-only bridge and four CPU threads as the adapter:

```bash
DEMOTIF_DIFFSINGER_REFERENCE="$PWD/data/models/diffsinger-reference" \
uv run --project workers/singing python workers/singing/reference_cli.py \
  "$PWD/data/models/opencpop-native-demo/demo-2s.ds" \
  --exp 0116_female_triplet_ds1000 --spk opencpop --seed 1234 --speedup 10 \
  --out "$PWD/data/models/opencpop-native-demo/reference"
```

The adapter preserves native float PCM. The reference CLI saves int16 WAV, so compare after accounting for that quantization. Benchmark figures are measured artifacts, not a general real-time guarantee or a substitute for listening.

## Worker protocol

Run `uv run --project workers/singing python workers/singing/worker.py` and send one JSON object per line. Protocol 1 supports `ready`, `render`, `render_source`, and `shutdown`. A render specifies `id`, an absolute `profile` path, `score_path`, `output_path`, optional `device` (`cpu` by default), and `seed`.

Stdout contains JSON events only; upstream output goes to stderr. Events report loading, synthesis, completion or a structured error. The same process reuses its loaded singer. Audio is atomically published as a file rather than sent as base64. The Node adapter serializes inference, keeps the process warm, persists jobs and kills/restarts the child on active cancellation. `render_source` accepts the immutable `{source,tempo}` snapshot; `render` accepts upstream DS score input.

## Studio and verification

Open Library → plus → Vocal. Select the installed voice and language, add monophonic notes, then use Lyrics or a note dialog to assign syllables. A note dialog accepts a complete phrase inside the selected note by default, preserving its pitch, time and following notes. Space-separated Pinyin overrides map to those syllables. Split into N notes explicitly divides only the selected note into equal notes; no placement-mode switch is needed. The source stays intact until Apply succeeds. `-` continues the preceding syllable; after a multiple-syllable note it extends only the final syllable. The whole-clip Lyrics dialog preserves existing within-note grouping. For Chinese polyphonic characters, keep the lyric label and enter a separate Pinyin override (for example 乐 → yue). Automatic reading uses phrase context, but explicit Pinyin takes precedence; raw phonemes have the highest priority. Phoneme overrides accept `symbol:duration_beats` tokens. Synthesize explicitly, or press the clip loop button to prepare the current score and start playback when ready. Stopping or closing the editor cancels work started by that playback request, while an independently started render keeps running. Pitch/volume curves and vibrato affect the actual inference input. Render completion does not save or alter the score. Missing/stale audible vocals block playback; mute the vocal track to hear only the accompaniment. Export resolves full-quality vocals before browser mixing.

```bash
DEMOTIF_TEST_NATIVE_SINGING=1 npm test -- --run src/server/vocals/native.test.ts
```

Ordinary `npm test`, build and instrumental editing work without this optional environment or models. To disable inference, remove the local profile or set the worker executable to an uninstalled location; scores and already rendered matching audio remain intact. For code rollback, retain a SQLite backup from before vocal edits; older builds cannot interpret vocal sources. Never strip score data to make an older build load it.
