import re

from app.adapters.agent.base import ProducerReply
from app.schemas.command import AddClip, AddTrack, Command, RenameProject, SetTempo, SetTrackLock
from app.schemas.document import ProjectDocument, TrackKind

TRACK_KINDS: dict[str, TrackKind] = {
    "drum": "drums",
    "drums": "drums",
    "percussion": "drums",
    "bass": "instrument",
    "piano": "instrument",
    "keys": "instrument",
    "guitar": "instrument",
    "synth": "instrument",
    "strings": "instrument",
    "vocal": "vocal",
    "vocals": "vocal",
    "voice": "vocal",
}


class FakeProducer:
    """Deterministic stand-in for the real producer agent, used for local development."""

    async def respond(self, text: str, document: ProjectDocument) -> ProducerReply:
        lowered = text.lower().strip()
        commands: list[Command] = []

        tempo = re.search(r"(?:tempo|bpm)\D{0,10}(\d{2,3})", lowered)
        if tempo:
            commands.append(SetTempo(tempo=int(tempo.group(1))))

        rename = re.search(r"(?:rename|call) (?:it|the project) (?:to )?(.+)$", text, re.IGNORECASE)
        if rename:
            commands.append(RenameProject(name=rename.group(1).strip().strip('"')))

        lock = re.search(r"(lock|unlock) (?:the )?(\w+)", lowered)
        if lock and document.tracks:
            track = next((item for item in document.tracks if lock.group(2) in item.name.lower()), None)
            if track:
                commands.append(SetTrackLock(track_id=track.id, locked=lock.group(1) == "lock"))

        added_track = re.search(r"add (?:a |an )?(?:new )?(\w+) (?:track|part)", lowered)
        if added_track:
            word = added_track.group(1)
            kind = TRACK_KINDS.get(word, "instrument")
            commands.append(AddTrack(name=word.capitalize(), kind=kind))

        clip = re.search(r"add (?:a |an )?(?:(\d+)[ -]?bars? )?(?:clip|loop|part)", lowered)
        if clip:
            target = next((track for track in document.tracks if not track.locked), None)
            if target is None:
                return ProducerReply(
                    message="I can add a clip, but every track is locked or missing. Add or unlock a track first.",
                    commands=commands,
                )
            length = float(clip.group(1)) * 4 if clip.group(1) else 4.0
            start = max((clip.start_beat + clip.length_beats for clip in target.clips), default=0.0)
            commands.append(
                AddClip(track_id=target.id, name="New part", kind="audio", start_beat=start, length_beats=length)
            )

        if commands:
            return ProducerReply(message="Here is what I would change. Apply the edits you want to keep.", commands=commands)

        names = ", ".join(track.name for track in document.tracks) or "none yet"
        return ProducerReply(
            message=(
                f"I can adjust tempo, rename the project, add tracks or clips, and lock sections. "
                f"Current tracks: {names}."
            )
        )
