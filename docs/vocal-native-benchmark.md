# Native PyTorch singing benchmark

Measured on 2026-11-04, Apple M5, macOS arm64, 24 GiB system RAM, CPU with 4 PyTorch threads. No CUDA or MPS measurements were made.

## Profile and scope

OpenVPI DiffSinger v1.5.0, revision `12da2afc5f948b65f3d4fee9e0f3893427f841f9`; official `0116_female_triplet_ds1000` acoustic checkpoint with speaker `opencpop` only, paired with the official 2022-12-11 NSF-HiFiGAN native vocoder. This is a user-approved **non-commercial local Demo**. The stock model has no independent modern duration/pitch prediction package, so the experiment supplies explicit phoneme timing and pitch. It does not claim to reproduce an AI automatic-tuning feature.

Python 3.11, PyTorch 2.5.1, float32 native model computation, upstream PNDM sampling speedup 10 (100 denoising iterations, matching the supplied model config). No ONNX, model conversion or quantization. See `workers/singing/uv.lock` for the exact environment.

## Measured results

Warm phrase render wall time includes native synthesis and writing the float WAV, but not downloading weights or the initial model load.

| Requested phrase | Actual WAV duration | Warm render time | RTF (render time / audio duration) |
| --- | --- | --- | --- |
| 2 s | 2.0085 s | 3.483 s | 1.734 |
| 5 s | 5.0039 s | 5.808 s | 1.161 |
| 10 s | 10.0078 s | 10.659 s | 1.065 |

- Cold model initialization after packages/files were locally installed: 2.569 s. This is not a clean-machine install time or a guarantee about OS disk caches.
- Peak process RSS across load and the benchmark: 1.843 GiB.
- Audio: 44,100 Hz mono float WAV, model hop 512 samples.
- Repeated 2-second generation with the same seed in one warm process: maximum float sample difference 0.0.
- The 30-second assembled example concatenates three rendered 10-second phrases and is 30.0234 seconds; it is not a measurement of a single 30-second neural inference call.

## Reference comparison

The pinned upstream `main.py` was run independently for all three DS fixtures using the same seed (1234), CPU threads, speaker and sampling settings. The CLI launcher only avoids eager imports of unrelated training/vocoder packages; model, sampler and vocoder computation are unchanged.

For 2-, 5- and 10-second fixtures, the native adapter and CLI have identical sample counts, zero alignment offset and **zero PCM16 sample difference** after reproducing the upstream CLI's float64 concatenation and int16 WAV conversion. The adapter retains float PCM for later mixing. Float-versus-int16 differences alone are expected quantization, not a model-quality difference.

All produced samples are finite, nonempty and below clipping in these fixtures. This establishes reference-path equivalence, not a subjective naturalness score. The user listened to the supplied preview and accepted this reference voice for Demo integration on 2026-11-04. This is Demo acceptance, not a quantified naturalness score or commercial voice approval. The generated original phrase is “你好音乐”; no existing song recording or melody was used.

## Artifacts and reproduction

- Local samples/report: `data/models/opencpop-native-demo/results/`.
- Reference CLI WAVs: `data/models/opencpop-native-demo/reference/`.
- Profile: `data/models/opencpop-native-demo/profile.json`.
- Reproduction commands and third-party notices: `workers/singing/README.md` and `workers/singing/NOTICE`.
- No weights or generated audio are committed to source control.

Verified artifact SHA-256:

- `model_ckpt_steps_320000.ckpt`: `d5b893f987f24f065ec2d7785a45a4fa677d7b83866c29dd10f1314af0904ad2`
- `model`: `2c576b63b7ed952161b70fad34e0562ace502ce689195520d8a2a6c051de29d6`
- `config.json`: `9707614b59c299766a91ea25b5ec62cfd813a45a902766c454f75b6868118684`
- `spk_map.json`: `87e9122c9764ff543952a15ed73ae0a2c0243a6fdb18264eb4d73d434ee11df6`
- `config.yaml`: `3cafe68a7009a54f38087621b9c6e1c1db3dd6a60367acf5a18510a81c221896`
- `opencpop-strict.txt`: `de93f24026743d1f2e2fe1ea06127a03e42ab55f302f0b79bb6412052a501b93`
- `opencpop-strict.txt`: `de93f24026743d1f2e2fe1ea06127a03e42ab55f302f0b79bb6412052a501b93`

## Studio integration verification

The Node queue → JSON Lines → native PyTorch → validated WAV → owned media pipeline was exercised with the real installed profile. Equivalent requests reused audio without advancing score versions; Save as/reopen preserved usable remapped bindings. A second real inference changed pitch/vibrato and applied a 0.25 volume envelope; its waveform changed and peak fell below 60% of the baseline. The opt-in integration test is `src/server/vocals/native.test.ts` (about 10 seconds on the development host).

Chinese lyrics use phrase-context pronunciation and support a separate per-note Pinyin override (`乐` with `yue`), followed by optional raw phoneme/timing overrides. Tests verify this precedence and preserve those overrides when unchanged whole-phrase lyrics are reassigned.

The production build was checked at desktop and 390px widths for vocal creation, piano-roll lyric/Pinyin editing, Escape/focus return and expression controls. A browser mix export combining the original singing phrase with instrumental tracks produced an 8.571429-second, 44.1 kHz stereo WAV. Listening approval of this assembled mix remains a user review; the earlier reference-voice acceptance does not claim a listening comparison of the final mix. Screenshots and rendered audio stay temporary and are not repository assets.

## Phrase-entry refinement verification

An opt-in real native test rendered “我的妈啊” as four syllables within one E4 note lasting four quarter-note beats at 120 BPM. The persisted score retained one note, the derived result became ready, and the project version did not advance on completion. The original multi-note integration test also passed (two installed-model tests total). The new compiler fixtures verify per-syllable budgets, constant F0, context-sensitive readings, explicit Pinyin and final-syllable continuation. These remain fixed initial timing rules; no automatic timing predictor is claimed.

Service/helper tests cover forward mapping from a middle note, untouched prefix/suffix and pronunciation, no implicit overflow edits, explicit equal splitting with stable first-note identity, multiple-mode Save as/reopen, append-only undo and locked shared sources. Desktop/narrow browser checks exercised preview, forward Apply, within-note Apply, overflow splitting and successful keyboard focus return. Generated audio and screenshots are temporary artifacts, not source assets. The development server's repeated hot reload was resolved by retaining its old generated dev cache in a temporary directory and starting with a fresh cache; project storage was retained.
