import pytest
from pydantic import ValidationError

from app.core.errors import InvalidCommandError, LockedSectionError, NotFoundError
from app.models.project import Asset
from app.schemas.command import BatchRequest
from app.schemas.document import ProjectDocument, Source
from app.schemas.project import ProjectCreate
from app.services.command import apply_batch, undo_last_change
from app.services.history import changes, restore
from app.services.project import create_project


def source(id="s", **kw):
    return {
        "id": id,
        "name": "Piano",
        "kind": "notes",
        "duration": 16,
        "notes": [{"id": "n", "pitch": 60, "start": 0, "duration": 1, "velocity": 0.7}],
        **kw,
    }


async def batch(session, project, commands, id=None, version=None):
    return await apply_batch(
        session,
        project,
        BatchRequest(
            request_id=id or f"v{project.version}", expected_version=version or project.version, commands=commands
        ),
    )


async def test_atomic_shared_sources_undo_and_retry(session):
    project = await create_project(session, ProjectCreate(name="Music"))
    commands = [
        {"type": "track.add", "id": "t", "name": "Track"},
        {"type": "source.add", "source": source()},
        {"type": "part.add", "part": {"id": "p", "name": "Part", "source_id": "s", "duration": 16}},
        *[
            {
                "type": "clip.add",
                "id": f"c{i}",
                "track_id": "t",
                "name": "Part",
                "kind": "midi",
                "source_id": "s",
                "start_beat": i * 16,
                "length_beats": 16,
            }
            for i in range(2)
        ],
    ]
    result = await batch(session, project, commands, id="one", version=1)
    assert result.project.version == 2
    again = await batch(session, project, commands, id="one", version=1)
    assert again.project.version == 2 and len(again.project.document.tracks[0].clips) == 2
    await batch(
        session,
        project,
        [{"type": "source.update", "source_id": "s", "notes": [{"id": "n", "pitch": 64, "duration": 2}]}],
    )
    assert project.document["sources"][0]["notes"][0]["pitch"] == 64
    await undo_last_change(session, project, project.version)
    assert project.document["sources"][0]["notes"][0]["pitch"] == 60
    assert project.document["parts"][0]["source_id"] == "s"
    assert len(project.document["tracks"][0]["clips"]) == 2


async def test_locks_protect_shared_sources_and_cross_track_moves(session):
    project = await create_project(session, ProjectCreate(name="Music"))
    await batch(
        session,
        project,
        [
            {"type": "source.add", "source": source()},
            {"type": "track.add", "id": "t", "name": "Locked"},
            {"type": "track.add", "id": "u", "name": "Unlocked"},
            {"type": "clip.add", "id": "c", "track_id": "t", "source_id": "s", "length_beats": 4},
            {"type": "clip.add", "id": "d", "track_id": "u", "source_id": "s", "length_beats": 4},
            {"type": "track.set_lock", "track_id": "t", "locked": True},
        ],
    )
    version = project.version
    with pytest.raises(LockedSectionError):
        await batch(session, project, [{"type": "source.update", "source_id": "s", "sound": "lead"}])
    with pytest.raises(LockedSectionError):
        await batch(
            session, project, [{"type": "clip.update", "track_id": "u", "clip_id": "d", "target_track_id": "t"}]
        )
    assert project.version == version
    await batch(
        session,
        project,
        [
            {"type": "source.add", "source": source("copy")},
            {"type": "clip.update", "track_id": "u", "clip_id": "d", "source_id": "copy"},
        ],
    )
    assert project.document["tracks"][1]["clips"][0]["source_id"] == "copy"


async def test_invalid_batch_changes_nothing(session):
    project = await create_project(session, ProjectCreate(name="Music"))
    with pytest.raises(NotFoundError):
        await batch(
            session,
            project,
            [{"type": "source.add", "source": source()}, {"type": "clip.add", "track_id": "missing", "source_id": "s"}],
        )
    assert project.version == 1 and project.document["sources"] == []
    with pytest.raises(InvalidCommandError):
        await batch(
            session,
            project,
            [{"type": "source.add", "source": source("s", kind="audio", asset_id="missing", notes=[])}],
        )
    assert project.version == 1


async def test_recorded_seconds_survive_tempo_and_split(session):
    project = await create_project(session, ProjectCreate(name="Music", tempo=120))
    session.add(
        Asset(
            id="a",
            project_id=project.id,
            kind="sample",
            filename="a.wav",
            content_type="audio/wav",
            size_bytes=100,
            storage_key="a.wav",
        )
    )
    await session.commit()
    await batch(
        session,
        project,
        [
            {"type": "source.add", "source": source("s", kind="audio", asset_id="a", duration=8, notes=[])},
            {"type": "track.add", "id": "t", "name": "Audio"},
            {
                "type": "clip.add",
                "id": "c",
                "name": "Audio",
                "track_id": "t",
                "source_id": "s",
                "offset": 2,
                "source_duration": 4,
                "length_beats": 8,
                "start_beat": 4,
            },
        ],
    )
    await batch(session, project, [{"type": "project.set_tempo", "tempo": 90.5}])
    clip = project.document["tracks"][0]["clips"][0]
    assert clip["offset"] == 2 and clip["source_duration"] == 4 and clip["start_beat"] == 4
    assert clip["length_beats"] == pytest.approx(4 * 90.5 / 60)
    await batch(session, project, [{"type": "clip.split", "track_id": "t", "clip_id": "c", "at_beat": 4 + 90.5 / 60}])
    clips = project.document["tracks"][0]["clips"]
    assert clips[0]["source_duration"] == pytest.approx(1)
    assert clips[1]["offset"] == pytest.approx(3)
    await undo_last_change(session, project, project.version)
    assert len(project.document["tracks"][0]["clips"]) == 1


def test_value_array_delta_and_step_automation_roundtrip():
    old = {
        "peaks": [0.1, 0.4],
        "lanes": [{"parameter": "gain", "points": [{"time": 0, "value": 1}, {"time": 4, "value": 0}]}],
    }
    new = {
        "peaks": [0.2],
        "lanes": [
            {
                "parameter": "gain",
                "points": [{"time": 0, "value": 0.5}, {"time": 4, "value": 0.2}, {"time": 4, "value": 1}],
            }
        ],
    }
    assert restore(old, changes(old, new)) == new
    assert restore(new, changes(new, old)) == old


def test_model_rejects_cycles_invalid_time_and_nan():
    with pytest.raises(ValidationError):
        ProjectDocument(mixer={"buses": [{"id": "a", "bus_id": "b"}, {"id": "b", "bus_id": "a"}]})
    with pytest.raises(ValidationError):
        ProjectDocument(tempo=90.55)
    with pytest.raises(ValidationError):
        ProjectDocument(time_signature="0/4")
    with pytest.raises(ValidationError):
        Source(**source(duration=float("inf")))
    with pytest.raises(ValidationError):
        ProjectDocument(sources=[source()], parts=[{"source_id": "s", "duration": 100}])
