"""Private Modal CPU inference for the validated Namine Ritsu voice."""

from hashlib import file_digest
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from typing import Any
from zipfile import ZipFile

import modal

DIRECTORY = Path(__file__).resolve().parent
SOURCE = "/opt/demotif-singing-ja"
SIFIGAN = "/opt/sifigan"
DICTIONARY = "/var/lib/mecab/dic/open-jtalk/naist-jdic"
REVISION = "cdb20daeb4da4a126077819091706ee90522c7a8"
ARCHIVE_HASH = "936e4d00b1aaee297f571aeae6a9ca28ee1b8b77dbc3725e86cabee3cf0bb3d5"
VOICE_ID = "ritsu-crisscross-2824-ja"
archive = Path("/models/ritsu.zip")
requirements = [
    line for line in (DIRECTORY / "nnsvs-requirements.txt").read_text().splitlines()
    if line and not line.startswith(("#", "torch==", "torchaudio==", "pyopenjtalk=="))
]

app = modal.App("demotif-singing-ja")
weights = modal.Volume.from_name("demotif-singing-ritsu")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake", "git", "libsndfile1", "open-jtalk-mecab-naist-jdic=1.11-3")
    .uv_pip_install("torch==2.5.1", "torchaudio==2.5.1", index_url="https://download.pytorch.org/whl/cpu")
    .uv_pip_install("pyopenjtalk==0.4.1", "numpy==1.23.5", "setuptools==75.8.2", "wheel", "Cython<3")
    .uv_pip_install("scipy==1.10.1")
    .uv_pip_install(*requirements, extra_options="--no-build-isolation")
    .run_commands(
        f"git init {SIFIGAN}",
        f"git -C {SIFIGAN} fetch --depth=1 https://github.com/chomeyama/SiFiGAN.git {REVISION}",
        f"git -C {SIFIGAN} checkout --detach FETCH_HEAD",
    )
)
for filename in ("nnsvs_native.py", "japanese_score.py"):
    image = image.add_local_file(str(DIRECTORY / filename), f"{SOURCE}/{filename}")
image = image.add_local_file(str(DIRECTORY / "nnsvs-requirements.txt"), "/root/nnsvs-requirements.txt")


@app.cls(image=image, cpu=2, memory=4096, timeout=180, min_containers=0, max_containers=2,
         scaledown_window=60, volumes={"/models": weights.with_mount_options(read_only=True)})
class Singing:
    @modal.enter()
    def load(self) -> None:
        sys.path.insert(0, SOURCE)
        from nnsvs_native import JapaneseSinger

        with archive.open("rb") as stream:
            if file_digest(stream, "sha256").hexdigest() != ARCHIVE_HASH:
                raise ValueError("Japanese voice archive does not match the validated release")
        self.model_files = TemporaryDirectory(prefix="demotif-ritsu-")
        with ZipFile(archive) as packaged:
            packaged.extractall(self.model_files.name)
        root = Path(self.model_files.name)
        model = next(root.rglob("acoustic_model.pth")).parent
        profile = root / "profile.json"
        profile.write_text(json.dumps({
            "engine": "nnsvs", "language": "ja", "artifacts": [],
            "model_root": str(model), "reference_root": SIFIGAN, "dictionary_root": DICTIONARY,
            "nnsvs_version": "0.1.1", "cpu_threads": 2, "intensity": "0030",
        }), encoding="utf-8")
        self.singer = JapaneseSinger(profile, "cpu")

    @modal.method()
    def render(self, voice_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        if voice_id != VOICE_ID:
            raise ValueError("Voice is unavailable on this worker")
        with TemporaryDirectory(prefix="demotif-singing-ja-") as directory:
            output = Path(directory) / "phrase.wav"
            result = self.singer.render_source(snapshot, output, 1234)
            del result["path"]
            return {"audio_wav": output.read_bytes(), "result": result}
