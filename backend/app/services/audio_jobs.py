import asyncio
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from sqlalchemy import select, update

from app.adapters.audio import provider
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.project import Asset, AudioJob, Project
from app.schemas.document import ProjectDocument, Source

_tasks: dict[str, asyncio.Task] = {}
_slots = asyncio.Semaphore(2)


def analysis_ready() -> bool:
    return bool(shutil.which("ffmpeg") and importlib.util.find_spec("librosa"))


def decode(path: Path, output: Path, seconds: float = 301) -> float:
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(path),
            "-t",
            str(seconds),
            "-ac",
            "2",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(output),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=60,
    )
    with wave.open(str(output), "rb") as audio:
        return audio.getnframes() / audio.getframerate()


async def analyze(request: provider.AudioRequest, source: Source, asset: Asset) -> list[dict]:
    if not analysis_ready():
        raise ValueError("Install the analysis extra and ffmpeg")
    root = get_settings().media_root.resolve()
    path = (root / asset.storage_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Source media missing")

    def run():
        decoded = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
                str(path),
                "-t",
                "30.001",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "f32le",
                "pipe:1",
            ],
            capture_output=True,
            check=True,
            timeout=45,
        )
        if len(decoded.stdout) > 30 * 16000 * 4:
            raise ValueError("Analyze sources of at most 30 seconds")
        worker = Path(__file__).resolve().parents[1] / "adapters/audio/transcribe.py"
        result = subprocess.run(
            [
                sys.executable,
                str(worker),
                request.analysis_mode,
                str(request.min_pitch),
                str(request.max_pitch),
                str(request.drum_pitch),
            ],
            input=decoded.stdout,
            capture_output=True,
            check=True,
            timeout=90,
        )
        return json.loads(result.stdout)

    result = await asyncio.to_thread(run)
    return [{"analysis": result, "name": request.name, "source_id": source.id}]


async def materialize(job: AudioJob, resources: list[dict]) -> list[dict]:
    if not 1 <= len(resources) <= 4:
        raise ValueError("Invalid number of audio results")
    settings = get_settings()
    root = settings.media_root.resolve()
    results = []
    assets = []
    with tempfile.TemporaryDirectory() as directory:
        for i, r in enumerate(resources):
            original = Path(directory) / f"input-{i}"
            converted = Path(directory) / f"output-{i}.wav"
            await asyncio.to_thread(provider.download, r["url"], original)
            duration = await asyncio.to_thread(decode, original, converted)
            maximum = {"sound": 15, "speech": 30}.get(job.request["mode"], 60)
            if duration <= 0 or duration > maximum + 0.1:
                raise ValueError("Provider output exceeds supported duration")
            asset_id = hashlib.sha256(f"{job.id}:{i}".encode()).hexdigest()[:32]
            key = f"{job.project_id}/{asset_id}.wav"
            target = root / key
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(converted, target)
            assets.append(
                Asset(
                    id=asset_id,
                    project_id=job.project_id,
                    kind="sample",
                    filename=f"{job.request['name']}-{i + 1}.wav",
                    content_type="audio/wav",
                    size_bytes=target.stat().st_size,
                    storage_key=key,
                )
            )
            role = r.get("meta_data", {}).get("audio_track", {}).get("kind", "")
            source = Source(
                id=asset_id,
                name=f"{job.request['name']} {role or i + 1}",
                kind="audio",
                duration=duration,
                asset_id=asset_id,
            )
            results.append({"source": source.model_dump(mode="json"), "role": role})
    if job.request["mode"] == "separate" and {r["role"] for r in results} != {"voice", "background"}:
        raise ValueError("Separation did not return voice and accompaniment")
    async with SessionLocal() as db:
        for asset in assets:
            await db.merge(asset)
        record = await db.get(AudioJob, job.id)
        record.results = results
        record.status = "complete"
        record.error = None
        await db.commit()
    return results


async def execute(job_id: str) -> None:
    try:
        async with _slots, asyncio.timeout(660):
            async with SessionLocal() as db:
                job = await db.get(AudioJob, job_id)
                request = provider.AudioRequest.model_validate(job.request)
                project = await db.get(Project, job.project_id)
                document = ProjectDocument.model_validate(project.document)
                source = next((s for s in document.sources if s.id == request.source_id), None)
                if source is None and request.source_id:
                    completed = (
                        await db.scalars(
                            select(AudioJob).where(AudioJob.project_id == job.project_id, AudioJob.status == "complete")
                        )
                    ).all()
                    raw = next(
                        (
                            r["source"]
                            for j in completed
                            for r in j.results
                            if r.get("source", {}).get("id") == request.source_id
                        ),
                        None,
                    )
                    source = Source.model_validate(raw) if raw else None
                asset = await db.get(Asset, source.asset_id) if source and source.asset_id else None
            if request.mode == "transcribe":
                if not source or source.kind != "audio" or not asset or source.duration > 30:
                    raise ValueError("Choose an audio source of at most 30 seconds")
                results = await analyze(request, source, asset)
                async with SessionLocal() as db:
                    stored = await db.get(AudioJob, job_id)
                    stored.results = results
                    stored.status = "complete"
                    await db.commit()
                return
            if not job.upstream_id:
                ability, payload = request.payload()
                if request.mode == "separate":
                    if not source or not asset or source.duration > 60:
                        raise ValueError("Choose a generated source of at most 60 seconds")
                    async with SessionLocal() as db:
                        candidates = (
                            await db.scalars(
                                select(AudioJob).where(
                                    AudioJob.project_id == job.project_id, AudioJob.status == "complete"
                                )
                            )
                        ).all()
                        original = next(
                            (
                                j
                                for j in candidates
                                if j.request["mode"] not in ("separate", "transcribe")
                                and any(r.get("source", {}).get("asset_id") == asset.id for r in j.results)
                            ),
                            None,
                        )
                    if not original or not original.upstream_id:
                        raise ValueError("Separation currently supports generated audio only")
                    result = await provider.poll(original.upstream_id)
                    resources = json.loads(result["resp_payload"])["resources"]
                    index = next(i for i, r in enumerate(original.results) if r["source"]["asset_id"] == asset.id)
                    payload = {
                        "gen_type": "audio",
                        "resource_url": resources[index]["url"],
                        "audio_option": {
                            "type": "audio_2_audio",
                            "format": "wav",
                            "byteplus_mediakit": {"voice_separation": {"input_type": "audio", "scene": "music"}},
                        },
                    }
                    ability = "byteplus-ai-mediakit-voice-separation-official"
                response = await provider.submit(ability, payload)
                upstream = response.get("task_id")
                if not upstream:
                    raise ValueError("Submission result unknown; no automatic retry")
                async with SessionLocal() as db:
                    stored = await db.get(AudioJob, job_id)
                    stored.upstream_id = upstream
                    stored.status = "processing"
                    await db.commit()
                job.upstream_id = upstream
            for _ in range(200):
                result = await provider.poll(job.upstream_id)
                if result.get("status") == "succeed":
                    await materialize(job, json.loads(result["resp_payload"])["resources"])
                    return
                if result.get("status") in ("failed", "error", "cancelled"):
                    raise ValueError("Provider task failed")
                await asyncio.sleep(3)
            raise TimeoutError()
    except asyncio.CancelledError:
        async with SessionLocal() as db:
            await db.execute(
                update(AudioJob)
                .where(AudioJob.id == job_id)
                .values(status="interrupted", error="Stopped; submitted tasks are not resubmitted.")
            )
            await db.commit()
    except Exception as exc:  # noqa: BLE001 - isolate provider failures and redact secrets
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Audio processing failed. Resume an existing task rather than resubmitting."
        )
        async with SessionLocal() as db:
            await db.execute(update(AudioJob).where(AudioJob.id == job_id).values(status="failed", error=message[:500]))
            await db.commit()
    finally:
        _tasks.pop(job_id, None)


def start(job_id: str) -> None:
    if job_id not in _tasks:
        _tasks[job_id] = asyncio.create_task(execute(job_id))


async def shutdown() -> None:
    tasks = list(_tasks.values())
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def ensure_job(project_id: str, request: provider.AudioRequest) -> AudioJob:
    scope = get_settings().audio_base_url if request.mode != "transcribe" else "analysis-v2"
    fingerprint = hashlib.sha256(
        (project_id + "\n" + scope + "\n" + json.dumps(request.model_dump(mode="json"), sort_keys=True)).encode()
    ).hexdigest()
    async with SessionLocal() as db:
        job = await db.get(AudioJob, fingerprint)
        if not job:
            job = AudioJob(
                id=fingerprint, project_id=project_id, request=request.model_dump(mode="json"), status="submitting"
            )
            db.add(job)
            try:
                await db.commit()
            except Exception:
                await db.rollback()
                job = await db.get(AudioJob, fingerprint)
                if job is None:
                    raise
            else:
                start(job.id)
        return job
