"""Private CPU processing for Demotif media."""

from io import BytesIO
from pathlib import Path
from subprocess import run
from tempfile import TemporaryDirectory
from typing import Any, Literal
import wave

import modal

DIRECTORY = Path(__file__).resolve().parent
MAX_AUDIO_BYTES = 100 * 1024 * 1024
app = modal.App("demotif-media")
image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("ffmpeg")
    .uv_sync(str(DIRECTORY), uv_version="0.9.16", extra_options="--no-dev")
    .add_local_file(str(DIRECTORY / "transcribe.py"), "/opt/demotif-media/transcribe.py")
)


def decode(
    path: Path, channels: int, rate: int, format: str,
    offset: float = 0, duration: float | None = None,
) -> bytes:
    command = [
        "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-i", str(path), "-ss", str(offset),
    ]
    if duration is not None:
        command += ["-t", str(duration)]
    command += ["-ac", str(channels), "-ar", str(rate), "-fs", str(MAX_AUDIO_BYTES + 1), "-f", format, "pipe:1"]
    pcm = run(command, capture_output=True, check=True, timeout=60).stdout
    if len(pcm) > MAX_AUDIO_BYTES:
        raise ValueError("Decoded audio exceeds the size limit")
    return pcm


def wav(pcm: bytes, channels: int, rate: int) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm)
    return buffer.getvalue()


@app.function(image=image, cpu=2, memory=4096, timeout=180, min_containers=0, max_containers=4, scaledown_window=60)
def process(
    operation: Literal["excerpt", "normalize", "voice_wav", "probe", "transcribe"],
    audio: bytes,
    params: dict[str, Any],
) -> dict[str, Any]:
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("Invalid audio size")
    with TemporaryDirectory(prefix="demotif-media-") as directory:
        path = Path(directory) / "input"
        path.write_bytes(audio)
        if operation == "probe":
            result = run([
                "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
                "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ], capture_output=True, check=True, timeout=45)
            return {"duration": float(result.stdout.strip())}
        if operation == "excerpt":
            return {"audio": decode(path, 2, 44100, "s16le", params["offset"], params["duration"])}
        if operation == "normalize":
            pcm = decode(path, 2, 44100, "s16le", duration=300.101)
            return {"audio": wav(pcm, 2, 44100), "duration": len(pcm) / (44100 * 4)}
        if operation == "voice_wav":
            return {"audio": wav(decode(path, 1, 16000, "s16le"), 1, 16000)}
        if operation == "transcribe":
            import sys

            sys.path.insert(0, "/opt/demotif-media")
            import numpy as np
            from transcribe import analyze

            duration = params["duration"]
            if not 0 < duration <= 30:
                raise ValueError("Analyze sources of at most 30 seconds")
            pcm = decode(path, 1, 16000, "f32le", params["offset"], duration)
            return analyze(
                np.frombuffer(pcm, dtype="<f4"), params["mode"],
                params["min_pitch"], params["max_pitch"], params["drum_pitch"],
            )
        raise ValueError("Unknown media operation")
