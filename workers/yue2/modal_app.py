"""Private YuE2 deployment for Modal."""

from io import BytesIO
from pathlib import Path
import re
from typing import Literal, TypedDict

import modal

DIRECTORY = Path(__file__).resolve().parent
APP_NAME = "demotif"
MODEL = "m-a-p/YuE2-3B"
MODEL_REVISION = "8f24312f187763b9854adeec87e437e2b03bbff1"
VAE = "m-a-p/YuE2-Vae"
VAE_REVISION = "152733a19ad43aa67e367f9b5503ef8075bb5126"
# The ABC helper ships outside the upstream Python package at this revision.
YUE_REVISION = "1116bea76032bee5668e5f097294d082fa0b84f0"
CACHE_DIR = "/models/hub"

app = modal.App(APP_NAME)
weights = modal.Volume.from_name("demotif-yue2-weights", create_if_missing=True)
runtime = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libsndfile1")
    .uv_sync(str(DIRECTORY), uv_version="0.9.16")
    .run_commands(
        "python -c \"from pathlib import Path; from sysconfig import get_path; "
        "from urllib.request import urlretrieve; "
        "urlretrieve('https://raw.githubusercontent.com/multimodal-art-projection/YuE/"
        f"{YUE_REVISION}/skills/yue2-music/scripts/abc_tools.py', "
        "Path(get_path('purelib')) / 'demotif_yue2_abc.py')\""
    )
)


class Score(TypedDict):
    abc: str
    truncated: bool


class ScoreNote(TypedDict):
    start: float
    pitch: int
    duration: float


class ScoreChord(TypedDict):
    start: float
    symbol: str


class EditableScore(TypedDict):
    bpm: int
    meter: str
    duration_beats: float
    vocal: list[ScoreNote]
    instrumental: list[ScoreNote]
    chords: list[ScoreChord]


class ScoreBar(TypedDict):
    start: float
    duration: float
    meter: str


class ScoreKey(TypedDict):
    start: float
    key: str


class ScoreSection(TypedDict):
    start: float
    duration: float
    name: str


class ProjectScore(EditableScore):
    abc: str
    unit_length: str
    keys: list[ScoreKey]
    bars: list[ScoreBar]
    sections: list[ScoreSection]


def parse_project_score(abc: str) -> ProjectScore:
    from demotif_yue2_abc import parse_abc

    score = parse_abc(abc)
    vocal = score.voices["Vocal"]
    instrumental = score.voices["Ins"]
    bars: list[ScoreBar] = [
        {"start": float(start), "duration": float(duration), "meter": f"{n}/{d}"}
        for start, duration, (n, d) in vocal.bars
    ]
    section_starts: list[tuple[float, str]] = []
    pending_labels: list[str] = []
    bar_index = 0
    for index, line in enumerate(abc.splitlines()):
        if line.startswith("% ") and (label := line[2:].strip()):
            pending_labels.append(label)
        if score.music_lines.get(index) != "Vocal":
            continue
        if pending_labels:
            section_starts.append((bars[bar_index]["start"], " / ".join(pending_labels)))
            pending_labels.clear()
        for bar in line[:-1].split("|"):
            rest = re.fullmatch(r"Z([2-4])?", bar.strip())
            bar_index += int(rest.group(1) or "1") if rest else 1

    duration = float(vocal.time)
    sections: list[ScoreSection] = [
        {"start": start, "duration": end - start, "name": name}
        for (start, name), end in zip(
            section_starts, [start for start, _ in section_starts[1:]] + [duration]
        )
    ]
    return {
        "abc": abc,
        "unit_length": str(score.unit),
        "bpm": score.bpm,
        "meter": bars[0]["meter"],
        "duration_beats": duration,
        "vocal": [
            {"start": float(start), "pitch": pitch, "duration": float(length)}
            for start, pitch, length in vocal.notes
        ],
        "instrumental": [
            {"start": float(start), "pitch": pitch, "duration": float(length)}
            for start, pitch, length in instrumental.notes
        ],
        "chords": [{"start": float(start), "symbol": symbol} for start, symbol in vocal.chords],
        "keys": [{"start": float(start), "key": key} for start, key in vocal.keys],
        "bars": bars,
        "sections": sections,
    }


class Song(TypedDict):
    abc: str | None
    audio_flac: bytes
    sample_rate: int
    audio_seconds: float
    truncated: dict[str, bool]


class RenderedArrangement(TypedDict):
    song: Song
    score: ProjectScore


@app.function(
    image=modal.Image.debian_slim(python_version="3.12").uv_sync(
        str(DIRECTORY), uv_version="0.9.16", extra_options="--only-group weights"
    ),
    volumes={"/models": weights},
    max_containers=1,
    timeout=1200,
)
def cache_weights() -> dict[str, str]:
    from huggingface_hub import snapshot_download

    for repo, revision in ((MODEL, MODEL_REVISION), (VAE, VAE_REVISION)):
        snapshot_download(repo, revision=revision, cache_dir=CACHE_DIR, token=False)
    weights.commit()
    return {MODEL: MODEL_REVISION, VAE: VAE_REVISION}


@app.cls(
    image=runtime,
    gpu="L4",
    cpu=2,
    memory=16384,
    volumes={"/models": weights.with_mount_options(read_only=True)},
    min_containers=0,
    max_containers=2,
    scaledown_window=60,
    timeout=1200,
)
class YuE2:
    @modal.enter()
    def load(self) -> None:
        from yue2 import YuE2Pipeline

        self.pipeline = YuE2Pipeline.from_pretrained(
            MODEL,
            revision=MODEL_REVISION,
            vae=VAE,
            vae_revision=VAE_REVISION,
            cache_dir=CACHE_DIR,
            local_files_only=True,
            device="cuda",
            progress=False,
        )
        # The pinned upstream pipeline normally loads this lazily on first inference.
        self.pipeline._load_model()

    @modal.method()
    def health(self) -> dict[str, str | bool | float]:
        import torch

        device = torch.cuda.get_device_properties(0)
        return {
            "ready": True,
            "gpu": device.name,
            "vram_gib": round(device.total_memory / 2**30, 2),
            "bf16": torch.cuda.is_bf16_supported(),
            "torch": str(torch.__version__),
            "model_revision": MODEL_REVISION,
            "vae_revision": VAE_REVISION,
        }

    @modal.method()
    def plan(
        self, style: str, lyrics: str, seed: int = 42,
        cot: Literal["full", "melody"] = "full",
    ) -> Score:
        if cot not in ("full", "melody"):
            raise ValueError("Score planning requires cot='full' or 'melody'.")
        score = self.pipeline.plan(style=style, lyrics=lyrics, seed=seed, cot=cot)
        if not score.abc:
            raise ValueError("YuE2 returned an empty ABC score.")
        return {"abc": score.abc, "truncated": score.truncated}

    def _plan_project_score(self, style: str, lyrics: str, seed: int) -> ProjectScore:
        plan = self.pipeline.plan(style=style, lyrics=lyrics, seed=seed, cot="full")
        if not plan.abc or plan.truncated:
            raise ValueError("YuE2 did not return a complete ABC score.")
        return parse_project_score(plan.abc)

    @modal.method()
    def plan_editable(self, style: str, lyrics: str, seed: int = 42) -> EditableScore:
        score = self._plan_project_score(style, lyrics, seed)
        return {
            "bpm": score["bpm"],
            "meter": score["meter"],
            "duration_beats": score["duration_beats"],
            "vocal": score["vocal"],
            "instrumental": score["instrumental"],
            "chords": score["chords"],
        }

    @modal.method()
    def plan_project_score(self, style: str, lyrics: str, seed: int = 42) -> ProjectScore:
        return self._plan_project_score(style, lyrics, seed)

    def _render_song(
        self, style: str, lyrics: str, seed: int = 42,
        cot: Literal["full", "melody", "off"] = "full", abc: str | None = None,
    ) -> Song:
        import soundfile

        result = self.pipeline(style=style, lyrics=lyrics, seed=seed, cot=cot, abc=abc)
        audio = BytesIO()
        soundfile.write(audio, result.audio, result.sample_rate, format="FLAC", subtype="PCM_24")
        return {
            "abc": result.abc,
            "audio_flac": audio.getvalue(),
            "sample_rate": result.sample_rate,
            "audio_seconds": len(result.audio) / result.sample_rate,
            "truncated": result.truncated,
        }

    @modal.method()
    def render(
        self, style: str, lyrics: str, seed: int = 42,
        cot: Literal["full", "melody", "off"] = "full", abc: str | None = None,
    ) -> Song:
        return self._render_song(style, lyrics, seed, cot, abc)

    @modal.method()
    def render_arrangement(self, style: str, lyrics: str, seed: int = 42) -> RenderedArrangement:
        song = self._render_song(style, lyrics, seed)
        if not song["abc"] or song["truncated"].get("abc"):
            raise ValueError("YuE2 did not return a complete ABC score for the rendered arrangement.")
        return {"song": song, "score": parse_project_score(song["abc"])}
