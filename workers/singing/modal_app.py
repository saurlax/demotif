"""Private CUDA inference for the OpenCpop research voice."""
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import Any
import sys

import modal

DIRECTORY = Path(__file__).resolve().parent
REMOTE = PurePosixPath("/opt/demotif-singing")
PROFILE = REMOTE / "modal-opencpop-profile.json"
REFERENCE = "/opt/diffsinger"
REVISION = "12da2afc5f948b65f3d4fee9e0f3893427f841f9"

app = modal.App("demotif-singing")
checkpoints = modal.Volume.from_name("demotif-singing-opencpop")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libsndfile1")
    .uv_sync(str(DIRECTORY), uv_version="0.9.16")
    .run_commands(
        f"git init {REFERENCE}",
        f"git -C {REFERENCE} fetch --depth=1 https://github.com/openvpi/DiffSinger.git {REVISION}",
        f"git -C {REFERENCE} checkout --detach FETCH_HEAD",
        f"mv {REFERENCE}/checkpoints {REFERENCE}/reference-checkpoints",
    )
)
for filename in ("native.py", "score.py", "modal-opencpop-profile.json"):
    image = image.add_local_file(str(DIRECTORY / filename), str(REMOTE / filename))


@app.cls(
    image=image,
    gpu="L40S",
    cpu=4,
    memory=8192,
    min_containers=0,
    max_containers=2,
    scaledown_window=60,
    timeout=180,
    volumes={f"{REFERENCE}/checkpoints": checkpoints.with_mount_options(read_only=True)},
)
class Singing:
    @modal.enter()
    def load(self) -> None:
        sys.path.insert(0, str(REMOTE))
        from native import NativeSinger

        self.singer = NativeSinger(Path(PROFILE), "cuda")

    @modal.method()
    def render(self, voice_id: str, source: dict[str, Any], tempo: float) -> dict[str, Any]:
        if voice_id != self.singer.profile["id"]:
            raise ValueError("Voice is unavailable on this worker")
        with TemporaryDirectory(prefix="demotif-singing-") as directory:
            output = Path(directory) / "phrase.wav"
            result = self.singer.render_source(source, tempo, output)
            del result["path"]
            return {"audio_wav": output.read_bytes(), "result": result}
