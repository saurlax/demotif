from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

TrackKind = Literal["vocal", "instrument", "drums", "audio", "midi"]
ClipKind = Literal["audio", "midi", "generated"]


def new_id() -> str:
    return uuid4().hex


class Clip(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = "Clip"
    kind: ClipKind = "audio"
    start_beat: float = Field(default=0.0, ge=0)
    length_beats: float = Field(default=4.0, gt=0)
    asset_id: str | None = None
    locked: bool = False
    color: str | None = None


class Track(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = "Track"
    kind: TrackKind = "instrument"
    color: str | None = None
    muted: bool = False
    solo: bool = False
    locked: bool = False
    clips: list[Clip] = Field(default_factory=list)


class ProjectDocument(BaseModel):
    tempo: int = Field(default=120, ge=30, le=300)
    time_signature: str = "4/4"
    key: str | None = None
    tracks: list[Track] = Field(default_factory=list)

    def find_track(self, track_id: str) -> Track | None:
        return next((track for track in self.tracks if track.id == track_id), None)
