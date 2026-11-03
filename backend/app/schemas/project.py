from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.document import ProjectDocument


class ProjectCreate(BaseModel):
    name: str = Field(default="Untitled", min_length=1, max_length=200)
    tempo: float = Field(default=120, ge=20, le=300, allow_inf_nan=False)
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
    is_draft: bool = False
    draft_base_id: str | None = None
    draft_base_version: int | None = None
    draft_example_id: str | None = None
    has_unsaved_changes: bool = False
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
