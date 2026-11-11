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
uv run --project workers/singing python workers/singing/reference_cli.py "$PWD/data/models/diffsinger-reference" \
  "$PWD/data/models/opencpop-native-demo/demo-2s.ds" \
  --exp 0116_female_triplet_ds1000 --spk opencpop --seed 1234 --speedup 10 \
  --out "$PWD/data/models/opencpop-native-demo/reference"
```

The adapter preserves native float PCM. The reference CLI saves int16 WAV, so compare after accounting for that quantization. Benchmark figures are measured artifacts, not a general real-time guarantee or a substitute for listening.

## Worker protocol

For the private OpenCpop CUDA deployment, set `DEMOTIF_SINGING_MODAL_APP=demotif-singing` and, if needed, `DEMOTIF_SINGING_MODAL_ENVIRONMENT=main` on the Node host. Use Modal SDK credentials scoped to the deployment workspace. The worker uses the checked-in OpenCpop profile and the private `demotif-singing-opencpop` Volume. Populate that Volume with the profile's checkpoint files under their paths relative to the upstream `checkpoints/` directory, together with the upstream notices. The worker validates the manifest hashes on load. See the [Modal worker commands](../README.md) to check the lockfile and deploy.

The Node queue owns render state and publishes validated WAVs to the configured media store. The private OpenCpop deployment is for non-commercial evaluation. Set `DEMOTIF_SINGING_JA_MODAL_APP=demotif-singing-ja` to enable Namine Ritsu through the private Modal CPU deployment.

For offline benchmarks, run `uv run --project workers/singing python workers/singing/worker.py` and send one JSON object per line. Protocol 1 supports `ready`, `render`, `render_source`, and `shutdown`. A render specifies `id`, an absolute `profile` path, `score_path`, `output_path`, optional `device` (`cpu` by default), and `seed`.

Stdout contains JSON events only; upstream output goes to stderr. Events report loading, synthesis, completion or a structured error. The same process reuses its loaded singer. Audio is atomically published as a file. `render_source` accepts the immutable `{source,tempo}` snapshot; `render` accepts upstream DS score input.

## Studio and verification

Open Library → plus → Vocal. Select the installed voice and language, add monophonic notes, then use Lyrics or a note dialog to assign syllables. A note dialog accepts a complete phrase inside the selected note by default, preserving its pitch, time and following notes. Space-separated Pinyin overrides map to those syllables. Split into N notes explicitly divides only the selected note into equal notes; no placement-mode switch is needed. The source stays intact until Apply succeeds. `-` continues the preceding syllable; after a multiple-syllable note it extends only the final syllable. The whole-clip Lyrics dialog preserves existing within-note grouping. For Chinese polyphonic characters, keep the lyric label and enter a separate Pinyin override (for example 乐 → yue). Automatic reading uses phrase context, but explicit Pinyin takes precedence; raw phonemes have the highest priority. Phoneme overrides accept `symbol:duration_beats` tokens. Synthesize explicitly, or press the clip loop button to prepare the current score and start playback when ready. Stopping or closing the editor cancels work started by that playback request, while an independently started render keeps running. Pitch/volume curves and vibrato affect the actual inference input. Render completion does not save or alter the score. Missing/stale audible vocals block playback; mute the vocal track to hear only the accompaniment. Export resolves full-quality vocals before browser mixing.

```bash
DEMOTIF_TEST_NATIVE_SINGING=1 npm test -- --run src/server/vocals/native.test.ts
```

Ordinary `npm test`, build and instrumental editing work without Python or model weights. To disable a hosted voice, clear its Modal app setting. Scores and already rendered matching audio remain intact.

## Japanese native validation environment

Japanese synthesis uses a separate optional Python 3.11 environment. The existing DiffSinger environment is retained. On Linux, install a C/C++ compiler and Python development headers for the native audio packages, then:

```bash
python3.11 -m venv workers/singing/.venv-nnsvs
workers/singing/.venv-nnsvs/bin/python -m pip install pip==24.3.1 wheel==0.45.1 Cython==0.29.37
workers/singing/.venv-nnsvs/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchaudio==2.5.1
workers/singing/.venv-nnsvs/bin/python -m pip install --no-build-isolation -r workers/singing/nnsvs-requirements.txt
git clone https://github.com/chomeyama/SiFiGAN.git data/models/sifigan-reference
git -C data/models/sifigan-reference checkout cdb20daeb4da4a126077819091706ee90522c7a8
```

The selected SiFiGAN checkout supplies its unchanged native inference modules. Its training CLI and training-only dependency set are not installed. See `docs/japanese-vocal-model-screening.md` for the exact official CRISSCROSS archive, terms and digests. Extract that operator-acquired archive into ignored `data/models/`; retain its README and original model/configuration files.

Run this validation against the extracted directory containing `config.yaml`, `qst.hed`, the native checkpoints and scalers:

```bash
workers/singing/.venv-nnsvs/bin/python workers/singing/benchmark_japanese.py \
  --model 'data/models/ENUNU_波音リツ_CRISSCROSS_2824' \
  --sifigan-root data/models/sifigan-reference \
  --output data/models/japanese-validation
```

It renders the original kana phrase あおのきょうかい at 150 BPM with explicit model intensity `0030`, and writes a playable float WAV plus `validation.json` containing artifact hashes, runtime versions, PCM measurements and CPU timing/memory. This standalone validation does not edit a project or register a ready voice by itself. Mocked tests are not a replacement for this run.
### Registering the optional Japanese engine

NNSVS profiles use `engine: "nnsvs"`, `language: "ja"`, `model_root`,
`reference_root` (the pinned SiFiGAN source), `dictionary_root` (Open JTalk UTF-8
1.11 dictionary), `validation_report`, `nnsvs_version: "0.1.1"`, `intensity:
"0030"`, and the common identity/artifact/capability fields. Install
`pyopenjtalk==0.4.1` with build isolation enabled **before** installing the rest
of `nnsvs-requirements.txt` with `--no-build-isolation`; its source metadata needs its
own build backend. Preinstall the official Open JTalk dictionary; runtime
constructs `OpenJTalk(dn_mecab=...)` directly and never downloads a dictionary.

After the benchmark passes, register the local files:

```bash
python workers/singing/register_japanese.py \
  --model /operator/voice --sifigan /operator/SiFiGAN \
  --dictionary /operator/open_jtalk_dic_utf_8-1.11 \
  --report /operator/validation/validation.json \
  --output /operator/models/ritsu-crisscross-2824-ja/profile.json
```

The isolated Python executable is derived from `workers/singing/.venv-nnsvs` for the current OS. Voice profiles live under the configured data directory in `models/`. The catalog requires native
inference evidence, all model components, an installed dictionary, and matching
file hashes. Original README and dictionary/source licenses must accompany the
operator-installed files. Model files are not bundled in this repository.

The Japanese entry point `nnsvs_worker.py` speaks the existing protocol 1
(`ready`, `render_source`, `shutdown`, progress/error/complete events). It uses
the same audio/alignment result as DiffSinger. Switching engines or model
fingerprints restarts the warm process; cancelling kills it and publishes no
partial audio. Omitted `engine` keeps the existing DiffSinger path and hashes.

Japanese snapshots retain full-source pronunciation context before partitioning
into short phrases. Articulation gaps are retained, and continuations stay with
their preceding syllable. Kanji words spanning note boundaries need explicit
per-note kana when the reading boundary is ambiguous. Explicit kana and phoneme
overrides win over morphology; source lyrics, notes and revisions are unchanged.
Predicted phone durations are fitted into each accepted note budget, preserving
rests and clip alignment. NNSVS provides automatic pitch and phone timing plus
manual phone durations and volume. Manual pitch/vibrato are unavailable and
nonempty overrides are rejected rather than ignored. Japanese cache keys include
the full reading context, compiler, requirements and every installed artifact;
legacy DiffSinger cache signatures are unchanged.

## Object-backed native cache

The SQLite-owning backend publishes installed voice resources with the storage operator's `catalogs` command. The database stores a manifest of relative paths and immutable S3 references, including weights, dictionaries, native source, reports and licenses. On startup it reconstructs verified local model inputs and relocates profile paths. Python executables and environments remain runtime installations. Cache eviction does not remove durable audio or model objects; incompatible executables or altered model hashes still fail readiness. Only the owning backend runs native jobs; API-proxy frontends do not initialize workers. See `docs/architecture.md` for generic storage configuration and migration commands.
