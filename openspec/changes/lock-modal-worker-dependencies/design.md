## Decisions

Keep standalone uv projects for singing and YuE2. Singing requires Python 3.11 and PyTorch 2.5.1 with CUDA 12.4 on Modal. YuE2 uses Python 3.12 and PyTorch 2.10.0 with CUDA 12.8. Each GPU image uses its project's checked-in lock. Local singing commands retain their existing project and entry points.

Keep each deployed class and model Volume independent. Demotif Node submits authenticated method calls with the Modal SDK and owns result validation and project changes.
