from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from app.schemas.document import ClipKind, TrackKind
from app.schemas.project import ProjectRead, RevisionRead


def new_command_id() -> str:
    return uuid4().hex


class RenameProject(BaseModel):
    type: Literal["project.rename"] = "project.rename"
    name: str = Field(min_length=1, max_length=200)


class SetTempo(BaseModel):
    type: Literal["project.set_tempo"] = "project.set_tempo"
    tempo: int = Field(ge=30, le=300)


class AddTrack(BaseModel):
    type: Literal["track.add"] = "track.add"
    name: str = Field(min_length=1, max_length=120)
    kind: TrackKind = "instrument"
    color: str | None = None


class RemoveTrack(BaseModel):
    type: Literal["track.remove"] = "track.remove"
    track_id: str


class SetTrackLock(BaseModel):
    type: Literal["track.set_lock"] = "track.set_lock"
    track_id: str
    locked: bool


class AddClip(BaseModel):
    type: Literal["clip.add"] = "clip.add"
    track_id: str
    name: str = Field(default="Clip", max_length=120)
    kind: ClipKind = "audio"
    start_beat: float = Field(default=0.0, ge=0)
    length_beats: float = Field(default=4.0, gt=0)
    asset_id: str | None = None


class MoveClip(BaseModel):
    type: Literal["clip.move"] = "clip.move"
    track_id: str
    clip_id: str
    start_beat: float = Field(ge=0)


class RemoveClip(BaseModel):
    type: Literal["clip.remove"] = "clip.remove"
    track_id: str
    clip_id: str


Command = Annotated[
    RenameProject | SetTempo | AddTrack | RemoveTrack | SetTrackLock | AddClip | MoveClip | RemoveClip,
    Field(discriminator="type"),
]


class CommandRequest(BaseModel):
    command_id: str = Field(default_factory=new_command_id)
    expected_version: int
    command: Command


class CommandResult(BaseModel):
    project: ProjectRead
    revision: RevisionRead
    applied: Command


class UndoResult(BaseModel):
    project: ProjectRead
    revision: RevisionRead


class AgentMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    expected_version: int


class AgentMessageResponse(BaseModel):
    reply: str
    commands: list[Command] = Field(default_factory=list)
