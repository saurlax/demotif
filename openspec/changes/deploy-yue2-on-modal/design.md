## Context

Demotif owns project edits and playback separately from generation providers. YuE2's upstream pipeline exposes symbolic planning and audio rendering independently.

## Goals / Non-Goals

Deploy a private worker and verify that it starts on the chosen GPU with the expected model files. Project integration and execution of generation tests are outside this deployment.

## Decisions

- Put the deployment in `workers/yue2/modal_app.py`. Use the existing Modal workspace and `main` environment with a dedicated `demotif` App.
- Use the upstream Python pipeline at pinned code and weight revisions. Populate a dedicated Volume from a CPU function, then mount it read-only on GPU workers.
- Use one NVIDIA L4 per container. Its 24 GB of VRAM and BF16 support match upstream's starting configuration. Start with zero minimum containers, two maximum containers, one request per container, and a 60-second idle window.
- Use Modal's authenticated RPC for this deployment. A future Demotif provider can handle calls and route accepted results through project commands.

## Risks / Trade-offs

Cold starts include loading the cached weights into GPU memory. Health validates initialization. Musical correctness, render latency, and peak memory remain to be measured during the subsequent generation tests.
