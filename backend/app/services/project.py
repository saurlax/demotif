from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.project import Operation, Project
from app.schemas.document import ProjectDocument
from app.schemas.project import ProjectCreate


async def create_project(
    session: AsyncSession,
    data: ProjectCreate,
    *,
    is_draft: bool = False,
    example_id: str | None = None,
) -> Project:
    document = ProjectDocument(tempo=data.tempo, time_signature=data.time_signature)
    state = document.model_dump(mode="json")
    project = Project(
        name=data.name,
        document=state,
        version=1,
        is_draft=is_draft,
        draft_example_id=example_id,
        draft_checkpoint={"name": data.name, "document": state} if is_draft else None,
    )
    session.add(project)
    await session.flush()
    session.add(
        Operation(
            project_id=project.id,
            version=1,
            summary="Project created",
            forward=[],
            inverse=[],
            baseline=True,
        )
    )
    await session.commit()
    await session.refresh(project)
    return project


async def list_projects(session: AsyncSession) -> list[Project]:
    result = await session.execute(
        select(Project).where(Project.is_draft.is_(False)).order_by(Project.updated_at.desc())
    )
    return list(result.scalars())


async def get_project(session: AsyncSession, project_id: str) -> Project:
    project = await session.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    return project


async def list_revisions(session: AsyncSession, project_id: str) -> list[Operation]:
    result = await session.execute(
        select(Operation).where(Operation.project_id == project_id).order_by(Operation.version.desc())
    )
    return list(result.scalars())
