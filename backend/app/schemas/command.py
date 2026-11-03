from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from app.schemas.document import (
    ClipKind,
    DrumSample,
    Effects,
    Mixer,
    Note,
    Part,
    Sampler,
    Section,
    Source,
    Synth,
    TrackKind,
)
from app.schemas.project import ProjectRead, RevisionRead


def new_command_id() -> str:
    return uuid4().hex


class RenameProject(BaseModel):
    type: Literal["project.rename"] = "project.rename"
    name: str = Field(min_length=1, max_length=200)


class SetTempo(BaseModel):
    type: Literal["project.set_tempo"] = "project.set_tempo"
    tempo: float = Field(ge=20, le=300, allow_inf_nan=False)


class SetTimeSignature(BaseModel):
    type: Literal["project.set_time_signature"] = "project.set_time_signature"
    time_signature: str = Field(pattern=r"^(?:[1-9]|[12][0-9]|3[0-2])/(?:1|2|4|8|16)$")


class AddTrack(BaseModel):
    id: str | None = None
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
    id: str | None = None
    source_id: str | None = None
    offset: float = Field(default=0, ge=0, allow_inf_nan=False)
    source_duration: float | None = Field(default=None, gt=0, allow_inf_nan=False)
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


class AddSource(BaseModel):
    type: Literal["source.add"] = "source.add"
    source: Source


class UpdateSource(BaseModel):
    type: Literal["source.update"] = "source.update"
    source_id: str
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: list[Note] | None = None
    duration: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    sound: str | None = None
    drum_kit: Literal["studio", "808", "909", "lofi"] | None = None
    synth: Synth | None = None
    sampler: Sampler | None = None
    drum_samples: list[DrumSample] | None = None


class AddPart(BaseModel):
    type: Literal["part.add"] = "part.add"
    part: Part


class RemovePart(BaseModel):
    type: Literal["part.remove"] = "part.remove"
    part_id: str


class UpdateTrack(BaseModel):
    type: Literal["track.update"] = "track.update"
    track_id: str
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = None
    muted: bool | None = None
    solo: bool | None = None
    gain: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    bus_id: str | None = None
    effects: Effects | None = None


class UpdateClip(BaseModel):
    type: Literal["clip.update"] = "clip.update"
    track_id: str
    clip_id: str
    target_track_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    start_beat: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    length_beats: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    offset: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    source_duration: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    source_id: str | None = None
    gain: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    fade_in: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    fade_out: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    envelope_offset: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    envelope_duration: float | None = Field(default=None, gt=0, allow_inf_nan=False)


class SplitClip(BaseModel):
    type: Literal["clip.split"] = "clip.split"
    track_id: str
    clip_id: str
    at_beat: float = Field(ge=0, allow_inf_nan=False)


class SetMixer(BaseModel):
    type: Literal["mixer.set"] = "mixer.set"
    mixer: Mixer


class SetSections(BaseModel):
    type: Literal["project.set_sections"] = "project.set_sections"
    sections: list[Section]


Command = Annotated[
    RenameProject
    | SetTempo
    | SetTimeSignature
    | AddTrack
    | RemoveTrack
    | SetTrackLock
    | AddClip
    | MoveClip
    | RemoveClip
    | AddSource
    | UpdateSource
    | AddPart
    | RemovePart
    | UpdateTrack
    | UpdateClip
    | SplitClip
    | SetMixer
    | SetSections,
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


class BatchRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    expected_version: int
    commands: list[Command] = Field(min_length=1, max_length=512)


class BatchResult(BaseModel):
    project: ProjectRead
    revision: RevisionRead
