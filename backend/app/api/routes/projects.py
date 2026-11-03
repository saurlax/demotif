from fastapi import APIRouter

from app.api.deps import SessionDep
from app.schemas.command import UndoResult
from app.schemas.project import ProjectCreate, ProjectRead, ProjectSummary, RevisionRead, UndoRequest
from app.services import command as command_service
from app.services import project as project_service
from app.services.history import read_project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectRead, status_code=201)
async def create_project(payload: ProjectCreate, session: SessionDep) -> ProjectRead:
    project = await project_service.create_project(session, payload)
    return await read_project(session, project)


@router.get("", response_model=list[ProjectSummary])
async def list_projects(session: SessionDep) -> list[ProjectSummary]:
    projects = await project_service.list_projects(session)
    return [ProjectSummary.model_validate(project) for project in projects]


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: str, session: SessionDep) -> ProjectRead:
    project = await project_service.get_project(session, project_id)
    return await read_project(session, project)


@router.get("/{project_id}/revisions", response_model=list[RevisionRead])
async def list_revisions(project_id: str, session: SessionDep) -> list[RevisionRead]:
    await project_service.get_project(session, project_id)
    revisions = await project_service.list_revisions(session, project_id)
    return [RevisionRead.model_validate(revision) for revision in revisions]


@router.post("/{project_id}/undo", response_model=UndoResult)
async def undo(project_id: str, payload: UndoRequest, session: SessionDep) -> UndoResult:
    project = await project_service.get_project(session, project_id)
    return await command_service.undo_last_change(session, project, payload.expected_version)
