# Modal workers

| Worker | Private Modal app | Python | Runtime | Compute |
| --- | --- | --- | --- | --- |
| [YuE2](yue2/modal_app.py) | `demotif` | 3.12 | 2.10.0 / CUDA 12.8 | L4 |
| [OpenCpop singing](singing/modal_app.py) | `demotif-singing` | 3.11 | 2.5.1 / CUDA 12.4 | L40S |
| [Japanese NNSVS singing](singing/modal_ja_app.py) | `demotif-singing-ja` | 3.11 | NNSVS / SiFiGAN | 2 vCPU, 4 GiB |
| [Audio processing](../analysis/modal_app.py) | `demotif-media` | 3.13 | FFmpeg / librosa | 2 vCPU, 4 GiB |

YuE2, OpenCpop and audio processing build from uv lockfiles. Japanese singing uses [pinned NNSVS requirements](singing/nnsvs-requirements.txt) and CPU PyTorch wheels. Model weights stay on private Modal Volumes. See the [singing worker notes](singing/README.md) for voice licensing and offline benchmarks.

From the repository root, use the Modal CLI (verified with 1.6.3) and the authenticated profile for the target workspace.

```sh
uv lock --check --project workers/yue2
uv lock --check --project workers/singing
uv lock --check --project analysis
modal deploy --env main workers/yue2/modal_app.py
modal deploy --env main workers/singing/modal_app.py
modal deploy --env main workers/singing/modal_ja_app.py
modal deploy --env main analysis/modal_app.py
```

Before deploying Japanese singing into a new environment, create the `demotif-singing-ritsu` Volume and upload the [validated CRISSCROSS archive](../docs/japanese-vocal-model-screening.md) to `/ritsu.zip`.

Configure the app names in [`.env.example`](../.env.example) on the Node host. Demotif calls `YuE2.plan_editable`, `YuE2.render_arrangement`, `Singing.render` and media `process` through authenticated private RPCs. Each `.spawn()` creates a `FunctionCall` with an `fc-…` ID. The backend awaits `.get()` and can request cancellation. Modal manages container startup, scaling and idle shutdown.
