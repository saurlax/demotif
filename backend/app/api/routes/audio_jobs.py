from fastapi import APIRouter
from sqlalchemy import select

from app.adapters.agent.harness import ready
from app.adapters.audio.provider import AudioRequest, available
from app.api.deps import SessionDep
from app.core.errors import ApiError, NotFoundError
from app.models.project import AudioJob
from app.services import audio_jobs
from app.services.project import get_project

router = APIRouter(tags=["audio"])


@router.get("/capabilities")
async def capabilities() -> dict:
    return {
        "producer": ready(),
        "audio_generation": available(),
        "vocal_separation": available(),
        "transcription": audio_jobs.analysis_ready(),
    }


def public(job: AudioJob) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "name": job.request["name"],
        "mode": job.request["mode"],
        "results": job.results,
        "error": job.error,
        "can_resume": bool(job.upstream_id and job.status != "complete"),
    }


@router.get("/projects/{project_id}/audio-jobs")
async def list_jobs(project_id: str, session: SessionDep) -> list[dict]:
    await get_project(session, project_id)
    jobs = (
        await session.scalars(
            select(AudioJob).where(AudioJob.project_id == project_id).order_by(AudioJob.created_at.desc())
        )
    ).all()
    return [public(job) for job in jobs]


@router.post("/projects/{project_id}/audio-jobs", status_code=202)
async def create_job(project_id: str, payload: AudioRequest, session: SessionDep) -> dict:
    await get_project(session, project_id)
    if not (audio_jobs.analysis_ready() if payload.mode == "transcribe" else available()):
        raise ApiError(503, "audio_unavailable", "Audio provider or analysis dependencies are not configured.")
    job = await audio_jobs.ensure_job(project_id, payload)
    return public(job)


@router.post("/projects/{project_id}/audio-jobs/{job_id}/{action}")
async def control_job(project_id: str, job_id: str, action: str, session: SessionDep) -> dict:
    job = await session.get(AudioJob, job_id)
    if not job or job.project_id != project_id:
        raise NotFoundError("Audio job not found")
    if action == "resume" and job.upstream_id and job.status != "complete":
        job.status = "processing"
        job.error = None
        await session.commit()
        audio_jobs.start(job.id)
    elif action == "cancel":
        task = audio_jobs._tasks.get(job_id)
        if task:
            task.cancel()
        if job.status not in ("complete", "failed"):
            job.status = "interrupted"
            await session.commit()
    else:
        raise ApiError(
            409, "cannot_resume", "This task cannot be resumed; it will not be submitted again automatically."
        )
    return public(job)
