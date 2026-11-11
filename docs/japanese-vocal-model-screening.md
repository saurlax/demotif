# Japanese native singing voice screening

Checked: 2026-11-06. This record completes package inspection, not inference verification. Do not mark the voice ready from this document alone.

## Selected package for runtime validation

- Voice: Namine Ritsu NNSVS/ENUNU CRISSCROSS Ver.1.0.0, model #2824, by Canon.
- [Official archive](https://www.canon-voice.com/voice/ENUNU_%E6%B3%A2%E9%9F%B3%E3%83%AA%E3%83%84_CRISSCROSS_2824.zip), 125,088,811 bytes; ZIP member CRC validation passed.
- SHA-256: `936e4d00b1aaee297f571aeae6a9ca28ee1b8b77dbc3725e86cabee3cf0bb3d5`.
- Package contains native acoustic, duration and time-lag checkpoints; all input/output scalers; Japanese kana/phoneme table; HTS questions; matching native SiFiGAN checkpoint, configuration and vocoder scalers. No training or ONNX conversion is needed to inspect this package.
- Acoustic config: `MDNMultistreamSeparateF0MelModel`, native diffusion mel model, predicted log-F0 and voiced/unvoiced streams; 80 mel bins, 48 kHz, 5 ms frames.
- Vocoder config: `sifigan.models.SiFiGANGenerator`, 48 kHz / 240-sample hop, 80-bin log-mel conditioning.
- The package README names SimpleEnunu 0.1.0 with SiFiGAN support as its tested runtime. NNSVS 0.1.1 compatibility remains subject to actual strict checkpoint loading and waveform generation.
- Intensity is encoded in HTS context flags; normal intensity and the packaged standard style must be selected explicitly and fingerprinted. These are model inputs, not permission to rewrite lyrics or user expression.

## Usage and attribution

The archive README points to the [voice owner's terms](https://www.canon-voice.com/terms/). Those terms permit commercial and non-commercial use, redistribution and processed redistribution. Package-specific non-UTAU terms take precedence; this inspected README adds a notice for distributing models derived through base-model training. This integration performs no training and does not distribute a derived model. Retain the original README and attribution with operator-installed artifacts.

Credits in the package: model by Canon; style databases by Chikano, MIZKI and Canon; icon by Kikun o Ji. The app need not redistribute the icon. No correspondence, additional permission request or agreement click was performed.

The SiFiGAN implementation is MIT licensed (Reo Yoneyama, 2022); model-weight usage is determined by the complete voice package, not that software license. The inspected SiFiGAN source revision is `cdb20daeb4da4a126077819091706ee90522c7a8`, archive SHA-256 `e92c4b236de5000fd5df13bb9840c75fa024261f63b2f9fdedefa5770c9dfdea`. NNSVS 0.1.1 source distribution SHA-256: `a96c6895a37e88d4bf193e6b55dab3c83992e1d59d0ccc4c7c6a30a995871f2d`.

## Key artifact digests

| Artifact | SHA-256 |
| --- | --- |
| acoustic_model.pth | `6bcf1bf0c35d791319fc53ca8b838aadec32a30ed41ed45edb2b7ee3d09ef4cb` |
| duration_model.pth | `7ac366f5e2dee8d04046f0005f50f42c789bdb89abb51d40236a7984af81c190` |
| timelag_model.pth | `a167107a0f6e0f2d8e55de460d44dfc261e7a457b853e010dd949b5518ed9981` |
| vocoder_model.pth | `ef181fd8dd3d0a832ea37afce3214fee3bc6490005475c5312210b2dd4889df5` |
| kana2phonemes.table | `444a2807d66acb3076f790524ac7223f2675ee1d22cf4c753add66cde7767b09` |
| qst.hed | `4889d4e5002107bd1633cfa7c362266128d2341cb1eab21474109519ba10870c` |
| README.txt | `ae9bf0694d3e81f36df1ad53a8f57ef1259cf106ccdc834a7679a869ae519c58` |

The private validation cache has the complete per-file manifest, including configuration and scaler digests. Models and deployment details are not committed.

## Acceptance gate

Verify strict native checkpoint loading with the pinned runtime, a real original Japanese phrase with the matching neural vocoder, valid PCM, note/lyric alignment, peak memory and wall time. A successful metadata inspection does not establish sound quality or operational readiness.

## Completed short native render

`workers/singing/benchmark_japanese.py` passed in an isolated Linux Python 3.11 environment with PyTorch/Torchaudio 2.5.1+cpu, NNSVS 0.1.1, nnmnkwii 0.1.3, pyworld 0.3.4 and utaupy 1.22.1. The matching SiFiGAN source revision above loaded the original checkpoints without changing model math.

The original seven-mora phrase produced 148,800 finite samples at 48 kHz (3.1 seconds), peak 0.2040 and RMS 0.0301. Model loading took 2.48 seconds, inference 14.72 seconds, with peak process RSS 1,131 MiB using two CPU threads. These are measurements of this short validation run, not a latency or memory guarantee for longer phrases. The private validation cache retains the WAV and complete JSON report.

## Application adapter verification

The native application adapter also rendered a multi-note score with short articulation gaps at 150 BPM: 149,472 samples at 48 kHz (3.114 seconds), including the configured 150-ms lead and 200-ms tail. The adapter constrains predicted phoneme proportions to each accepted note, preserves rests, and retains full-source reading context before phrase partitioning. Runtime startup and the existing JSON Lines readiness protocol passed with the original native checkpoints and the installed Open JTalk dictionary.

Automated checks passed: 126 TypeScript tests (3 optional tests skipped), six dependency-free Japanese compiler tests, TypeScript checking and a production Next.js build. Lint passed with existing warnings outside this change. These tests distinguish compiler/protocol checks from actual native inference; full arrangement playback and vocal-inclusive browser export are separate acceptance checks.

Supported expression is automatic pitch, predicted within-note phoneme timing, explicit phoneme durations and volume. Manual pitch curves and vibrato overrides are rejected. A kanji word split across notes needs explicit per-note kana when its reading boundary is ambiguous. The optional runtime remains Linux CPU oriented; no voice weights are bundled with the application.
