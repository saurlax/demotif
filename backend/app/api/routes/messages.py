from fastapi import APIRouter

from app.api.deps import ProducerDep, SessionDep
from app.core.errors import VersionConflictError
from app.schemas.command import AgentMessageRequest, AgentMessageResponse
from app.schemas.document import ProjectDocument
from app.services import project as project_service

router = APIRouter(prefix="/projects/{project_id}", tags=["producer"])


@router.post("/messages", response_model=AgentMessageResponse)
async def send_message(
    project_id: str, payload: AgentMessageRequest, session: SessionDep, producer: ProducerDep
) -> AgentMessageResponse:
    project = await project_service.get_project(session, project_id)
    if project.version != payload.expected_version:
        raise VersionConflictError(project.version)
    document = ProjectDocument.model_validate(project.document)
    reply = await producer.respond(payload.text, document)
    return AgentMessageResponse(reply=reply.message, commands=reply.commands)
