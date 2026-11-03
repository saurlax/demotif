from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.document import ProjectDocument


class ProjectCreate(BaseModel):
    name: str = Field(default="Untitled", min_length=1, max_length=200)
    tempo: int = Field(default=120, ge=30, le=300)
    time_signature: str = "4/4"


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: int
    created_at: datetime
    updated_at: datetime


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: int
    can_undo: bool = False
    document: ProjectDocument
    created_at: datetime
    updated_at: datetime


class RevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: str
    version: int
    summary: str
    created_at: datetime


class UndoRequest(BaseModel):
    expected_version: int
