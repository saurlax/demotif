from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

TrackKind = Literal["vocal", "instrument", "drums", "audio", "midi"]
ClipKind = Literal["audio", "midi", "generated"]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


def new_id() -> str:
    return uuid4().hex


class MusicalModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Note(MusicalModel):
    id: str = Field(default_factory=new_id)
    pitch: int = Field(ge=0, le=127)
    start: Nonnegative = 0
    duration: Positive = 1
    velocity: float = Field(default=0.8, gt=0, le=1)


class Effects(MusicalModel):
    highpass: float = Field(default=20, ge=20, le=20000)
    lowpass: float = Field(default=20000, ge=20, le=20000)
    drive: float = Field(default=0, ge=0, le=1)
    reverb: float = Field(default=0, ge=0, le=1)
    delay: float = Field(default=0, ge=0, le=1)
    sidechain: float = Field(default=0, ge=0, le=1)
    pan: float = Field(default=0, ge=-1, le=1)
    compressor: bool = False
    threshold: float = Field(default=-24, ge=-100, le=0)
    ratio: float = Field(default=4, ge=1, le=20)
    compAttack: float = Field(default=0.003, ge=0, le=1)
    compRelease: float = Field(default=0.25, ge=0, le=1)
    chorus: float = Field(default=0, ge=0, le=1)
    phaser: float = Field(default=0, ge=0, le=1)
    tremolo: float = Field(default=0, ge=0, le=1)
    autopan: float = Field(default=0, ge=0, le=1)
    bitcrusher: float = Field(default=0, ge=0, le=1)
    lowShelf: float = Field(default=0, ge=-12, le=12)
    highShelf: float = Field(default=0, ge=-12, le=12)
    softClip: float = Field(default=0, ge=0, le=1)
    width: float = Field(default=1, ge=0, le=2)
    air: float = Field(default=0, ge=0, le=1)
    multiband: float = Field(default=0, ge=0, le=1)


class Oscillator(MusicalModel):
    wave: Literal["saw", "sine", "square", "triangle"] = "saw"
    level: float = Field(default=0.5, ge=0, le=1)
    transpose: float = Field(default=0, ge=-48, le=48)
    voices: int = Field(default=1, ge=1, le=16)
    detune: float = Field(default=0, ge=0, le=100)
    spread: float = Field(default=0, ge=0, le=1)
    pan: float = Field(default=0, ge=-1, le=1)
    bypassFilter: bool = False


class Synth(MusicalModel):
    oscillators: list[Oscillator] | None = Field(default=None, max_length=3)
    attack: float = Field(default=0.01, ge=0, le=5)
    decay: float = Field(default=0.2, ge=0.01, le=5)
    sustain: float = Field(default=0.7, ge=0, le=1)
    release: float = Field(default=0.3, ge=0, le=8)
    cutoff: float = Field(default=12000, ge=20, le=20000)
    detune: float = Field(default=0, ge=-100, le=100)
    resonance: float = Field(default=0, ge=0, le=30)
    filterDrive: float = Field(default=0, ge=0, le=24)
    keytrack: float = Field(default=0, ge=0, le=1)


class Sampler(MusicalModel):
    rootNote: int = Field(default=60, ge=0, le=127)
    loopStart: Nonnegative | None = None
    loopEnd: Positive | None = None
    oneShot: bool = False

    @model_validator(mode="after")
    def validate_loop(self):
        if self.loopEnd is not None and self.loopEnd <= (self.loopStart or 0):
            raise ValueError("Sampler loop end must follow its start")
        return self


class DrumSample(MusicalModel):
    pitch: int = Field(ge=0, le=127)
    name: str = Field(max_length=120)
    asset_id: str
    gain: float = Field(default=1, ge=0, le=2)


SOUNDS = (
    "piano",
    "pluck",
    "supersaw",
    "lead",
    "sub",
    "reese",
    "air",
    "strings",
    "electric-piano",
    "guitar",
    "electric-bass",
    "brass",
    "flute",
    "organ",
    "analog-lead",
    "square-lead",
    "fm-bell",
    "mallet",
    "music-box",
    "kalimba",
    "nylon-guitar",
    "clav",
    "acid-bass",
    "fm-bass",
    "organ-bass",
    "warm-pad",
    "choir-pad",
    "glass-pad",
    "string-ensemble",
    "synth-brass",
)


class Source(MusicalModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(default="Part", min_length=1, max_length=120)
    kind: Literal["notes", "drums", "audio"] = "notes"
    duration: Positive = 16
    asset_id: str | None = None
    notes: list[Note] = Field(default_factory=list, max_length=10000)
    sound: str = "piano"
    drum_kit: Literal["studio", "808", "909", "lofi"] = "studio"
    synth: Synth = Field(default_factory=Synth)
    sampler: Sampler | None = None
    drum_samples: list[DrumSample] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def validate_source(self):
        if self.sound not in SOUNDS:
            raise ValueError("Unknown sound")
        if self.kind == "audio" and not self.asset_id:
            raise ValueError("Audio sources need a media asset")
        if self.kind == "audio" and self.notes:
            raise ValueError("Audio sources cannot contain editable notes")
        if self.kind != "audio" and any(n.start + n.duration > self.duration + 1e-6 for n in self.notes):
            raise ValueError("Notes exceed source duration")
        if len({n.id for n in self.notes}) != len(self.notes):
            raise ValueError("Duplicate note IDs")
        if len({r.pitch for r in self.drum_samples}) != len(self.drum_samples):
            raise ValueError("Duplicate drum sample pitches")
        return self


class Part(MusicalModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(default="Part", min_length=1, max_length=120)
    source_id: str
    offset: Nonnegative = 0
    duration: Positive = 16


class Clip(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(default_factory=new_id)
    name: str = "Clip"
    kind: ClipKind = "audio"
    start_beat: Nonnegative = 0
    length_beats: Positive = 4
    asset_id: str | None = None
    source_id: str | None = None
    offset: Nonnegative = 0
    source_duration: Positive | None = None
    gain: float = Field(default=1, ge=0, le=2)
    fade_in: Nonnegative = 0
    fade_out: Nonnegative = 0
    envelope_offset: Nonnegative = 0
    envelope_duration: Positive | None = None
    locked: bool = False
    color: str | None = None


class AutomationPoint(MusicalModel):
    time: Nonnegative
    value: float


class Automation(MusicalModel):
    parameter: Literal["gain", "lowpass", "highpass", "lowShelf", "highShelf"]
    points: list[AutomationPoint] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def validate_points(self):
        low, high = {
            "gain": (0, 2),
            "lowpass": (20, 20000),
            "highpass": (20, 20000),
            "lowShelf": (-12, 12),
            "highShelf": (-12, 12),
        }[self.parameter]
        if any(not low <= p.value <= high for p in self.points):
            raise ValueError("Automation value out of range")
        if any(a.time > b.time for a, b in zip(self.points, self.points[1:])):
            raise ValueError("Automation points must be ordered")
        return self


class Channel(MusicalModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(default="Bus", min_length=1, max_length=120)
    gain: float = Field(default=1, ge=0, le=2)
    effects: Effects = Field(default_factory=Effects)
    bus_id: str | None = None
    automation: list[Automation] = Field(default_factory=list, max_length=5)
    automation_bypassed: bool = False


class Mixer(MusicalModel):
    master: Channel = Field(default_factory=lambda: Channel(id="master", name="Master"))
    buses: list[Channel] = Field(default_factory=list, max_length=64)


class Section(MusicalModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=120)
    start: Nonnegative
    duration: Positive
    color: str = "#a1a1aa"


class Track(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(default_factory=new_id)
    name: str = "Track"
    kind: TrackKind = "instrument"
    color: str | None = None
    muted: bool = False
    solo: bool = False
    locked: bool = False
    gain: float = Field(default=0.7, ge=0, le=2)
    effects: Effects = Field(default_factory=Effects)
    bus_id: str | None = None
    clips: list[Clip] = Field(default_factory=list)


class ProjectDocument(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    tempo: float = Field(default=120, ge=20, le=300)
    time_signature: str = "4/4"
    key: str | None = None
    tracks: list[Track] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    parts: list[Part] = Field(default_factory=list)
    mixer: Mixer = Field(default_factory=Mixer)
    sections: list[Section] = Field(default_factory=list)

    def find_track(self, track_id: str) -> Track | None:
        return next((track for track in self.tracks if track.id == track_id), None)

    @model_validator(mode="after")
    def validate_document(self):
        if round(self.tempo, 1) != self.tempo:
            raise ValueError("Tempo supports one decimal place")
        try:
            numerator, denominator = map(int, self.time_signature.split("/"))
            assert 1 <= numerator <= 32 and denominator in (1, 2, 4, 8, 16)
        except (ValueError, AssertionError):
            raise ValueError("Invalid time signature") from None
        for collection in (self.tracks, self.sources, self.parts, self.sections, self.mixer.buses):
            if len({item.id for item in collection}) != len(collection):
                raise ValueError("Duplicate entity IDs")
        clips = [c for t in self.tracks for c in t.clips]
        if len({c.id for c in clips}) != len(clips):
            raise ValueError("Duplicate clip IDs")
        sources = {s.id: s for s in self.sources}
        for item in [*self.parts, *[c for c in clips if c.source_id]]:
            source = sources.get(item.source_id)
            if source is None:
                raise ValueError("Source does not exist")
            duration = item.duration if isinstance(item, Part) else item.source_duration
            if duration is None:
                duration = item.length_beats if source.kind != "audio" else item.length_beats * 60 / self.tempo
            if item.offset + duration > source.duration + 1e-6:
                raise ValueError("Source window exceeds source duration")
        buses = {b.id: b for b in self.mixer.buses}
        if "master" in buses or self.mixer.master.bus_id:
            raise ValueError("Invalid master routing")
        for channel in [*self.tracks, *self.mixer.buses]:
            seen = {channel.id}
            target = channel.bus_id
            while target:
                if target not in buses or target in seen:
                    raise ValueError("Invalid or cyclic bus route")
                seen.add(target)
                target = buses[target].bus_id
        return self
