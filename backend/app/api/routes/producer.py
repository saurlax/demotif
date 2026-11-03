import asyncio
import json
from hashlib import sha256

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.adapters.agent.harness import ready
from app.api.deps import SessionDep
from app.core.errors import ApiError, NotFoundError, VersionConflictError
from app.models.project import ProducerEvent, ProducerRun
from app.schemas.command import BatchRequest
from app.schemas.document import ProjectDocument
from app.services import producer
from app.services import project as projects
from app.services.command import apply_batch

router = APIRouter(prefix="/projects/{project_id}/producer", tags=["producer"])


class StartRun(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    expected_version: int


@router.get("")
async def history(project_id: str, session: SessionDep) -> dict:
    await projects.get_project(session, project_id)
    runs = (
        await session.scalars(
            select(ProducerRun).where(ProducerRun.project_id == project_id).order_by(ProducerRun.created_at)
        )
    ).all()
    result = []
    for run in runs:
        events = (
            await session.scalars(
                select(ProducerEvent).where(ProducerEvent.run_id == run.id).order_by(ProducerEvent.seq)
            )
        ).all()
        result.append(
            {
                "id": run.id,
                "prompt": run.prompt,
                "status": run.status,
                "base_version": run.base_version,
                "applied": run.applied,
                "commands": run.commands,
                "events": [{"seq": e.seq, **e.payload} for e in events],
            }
        )
    return {"ready": ready(), "runs": result}


@router.post("/runs", status_code=202)
async def start_run(project_id: str, payload: StartRun, session: SessionDep) -> dict:
    project = await projects.get_project(session, project_id)
    existing = await session.get(ProducerRun, payload.id)
    if existing:
        if (
            existing.project_id != project_id
            or existing.prompt != payload.text
            or existing.base_version != payload.expected_version
        ):
            raise ApiError(409, "request_conflict", "Run ID already used")
        return {"id": existing.id, "status": existing.status}
    if not ready():
        raise ApiError(
            503,
            "producer_unavailable",
            "Configure DEMOTIF_PRODUCER_MODEL and DEMOTIF_PRODUCER_API_KEY; install the producer extra.",
        )
    if project.version != payload.expected_version:
        raise VersionConflictError(project.version)
    if await session.scalar(
        select(ProducerRun.id).where(ProducerRun.project_id == project_id, ProducerRun.status == "running")
    ):
        raise ApiError(409, "producer_running", "A producer run is already active")
    previous = await session.scalar(
        select(ProducerRun)
        .where(ProducerRun.project_id == project_id, ProducerRun.status == "complete", ProducerRun.applied.is_(True))
        .order_by(ProducerRun.created_at.desc())
        .limit(1)
    )
    run = ProducerRun(
        id=payload.id, project_id=project_id, base_version=project.version, prompt=payload.text, status="running"
    )
    session.add(run)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        existing = await session.get(ProducerRun, payload.id)
        if (
            existing
            and existing.project_id == project_id
            and existing.prompt == payload.text
            and existing.base_version == payload.expected_version
        ):
            return {"id": existing.id, "status": existing.status}
        raise ApiError(409, "producer_running", "A producer run is already active or the request ID is in use") from exc
    producer.start(run.id, ProjectDocument.model_validate(project.document), previous.state if previous else None)
    return {"id": run.id, "status": run.status}


async def require_run(project_id: str, run_id: str, session) -> ProducerRun:
    run = await session.get(ProducerRun, run_id)
    if not run or run.project_id != project_id:
        raise NotFoundError("Producer run not found")
    return run


@router.get("/runs/{run_id}/events")
async def events(project_id: str, run_id: str, session: SessionDep, after: int = 0) -> StreamingResponse:
    await require_run(project_id, run_id, session)
    await session.rollback()

    async def stream():
        from app.db.session import SessionLocal

        cursor = after
        while True:
            async with SessionLocal() as db:
                run = await db.get(ProducerRun, run_id)
                rows = (
                    await db.scalars(
                        select(ProducerEvent)
                        .where(ProducerEvent.run_id == run_id, ProducerEvent.seq > cursor)
                        .order_by(ProducerEvent.seq)
                    )
                ).all()
                for row in rows:
                    cursor = row.seq
                    yield f"id: {cursor}\ndata: {json.dumps({'seq': cursor, **row.payload})}\n\n"
                if run.status != "running":
                    yield "event: done\ndata: {}\n\n"
                    break
            yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/runs/{run_id}/cancel")
async def cancel(project_id: str, run_id: str, session: SessionDep) -> dict:
    run = await require_run(project_id, run_id, session)
    task = producer._tasks.get(run.id)
    if task:
        task.cancel()
    if run.status == "running":
        run.status = "cancelled"
        await session.commit()
    return {"id": run.id, "status": run.status}


@router.post("/runs/{run_id}/apply")
async def apply(project_id: str, run_id: str, session: SessionDep):
    run = await require_run(project_id, run_id, session)
    if run.status != "complete" or not run.commands:
        raise ApiError(409, "proposal_unavailable", "No completed edit proposal")
    project = await projects.get_project(session, project_id)
    result = await apply_batch(
        session,
        project,
        BatchRequest(
            request_id=f"producer-{sha256(run.id.encode()).hexdigest()}",
            expected_version=run.base_version,
            commands=run.commands,
        ),
    )
    run.applied = True
    await session.commit()
    return result
