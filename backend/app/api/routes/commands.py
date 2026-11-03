from fastapi import APIRouter

from app.api.deps import SessionDep
from app.schemas.command import BatchRequest, BatchResult, CommandRequest, CommandResult
from app.services import command as command_service
from app.services import project as project_service

router = APIRouter(prefix="/projects/{project_id}", tags=["commands"])


@router.post("/commands", response_model=CommandResult)
async def apply_command(project_id: str, payload: CommandRequest, session: SessionDep) -> CommandResult:
    project = await project_service.get_project(session, project_id)
    return await command_service.apply_command(session, project, payload)


@router.post("/commands/batch", response_model=BatchResult)
async def apply_batch(project_id: str, payload: BatchRequest, session: SessionDep) -> BatchResult:
    project = await project_service.get_project(session, project_id)
    return await command_service.apply_batch(session, project, payload)
