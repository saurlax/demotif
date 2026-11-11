## Why

Run score-driven GPU vocal inference independently of the Next.js hosting platform.

## What Changes

- Deploy the existing CUDA-capable DiffSinger adapter as a private Modal App.
- Route the configured demo voice through Modal while retaining the existing Node queue and asset publication.

## Capabilities

### New Capabilities

- `modal-vocal-inference` provides authenticated on-demand vocal rendering.

### Modified Capabilities

None.

## Impact

Touches the inference provider and vocal job adapter. CPU-only NNSVS keeps its local execution path. Next.js deployment is outside this change.
