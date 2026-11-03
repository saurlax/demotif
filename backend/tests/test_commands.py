import pytest

from app.core.errors import LockedSectionError, VersionConflictError
from app.schemas.command import AddClip, AddTrack, CommandRequest, SetTempo, SetTrackLock
from app.schemas.project import ProjectCreate
from app.services.command import apply_command, undo_last_change
from app.services.project import create_project


async def test_command_advances_version_and_writes_revision(session):
    project = await create_project(session, ProjectCreate(name="Sketch", tempo=120))
    result = await apply_command(
        session, project, CommandRequest(expected_version=1, command=AddTrack(name="Drums", kind="drums"))
    )

    assert result.project.version == 2
    assert result.revision.summary == "Add drums track “Drums”"
    assert result.project.document.tracks[0].name == "Drums"


async def test_stale_version_is_rejected(session):
    project = await create_project(session, ProjectCreate(name="Sketch"))
    await apply_command(session, project, CommandRequest(expected_version=1, command=SetTempo(tempo=90)))

    with pytest.raises(VersionConflictError) as conflict:
        await apply_command(session, project, CommandRequest(expected_version=1, command=SetTempo(tempo=100)))

    assert conflict.value.payload == {"current_version": 2}


async def test_locked_track_rejects_clip_edits(session):
    project = await create_project(session, ProjectCreate(name="Sketch"))
    added = await apply_command(
        session, project, CommandRequest(expected_version=1, command=AddTrack(name="Vocal", kind="vocal"))
    )
    track_id = added.project.document.tracks[0].id
    locked = await apply_command(
        session,
        project,
        CommandRequest(expected_version=2, command=SetTrackLock(track_id=track_id, locked=True)),
    )

    with pytest.raises(LockedSectionError):
        await apply_command(
            session,
            project,
            CommandRequest(
                expected_version=3,
                command=AddClip(track_id=track_id, name="Verse", start_beat=0, length_beats=8),
            ),
        )
    assert locked.project.document.tracks[0].locked is True


async def test_undo_restores_previous_document_as_new_version(session):
    project = await create_project(session, ProjectCreate(name="Sketch"))
    await apply_command(
        session, project, CommandRequest(expected_version=1, command=AddTrack(name="Bass", kind="instrument"))
    )

    undone = await undo_last_change(session, project, expected_version=2)

    assert undone.project.version == 3
    assert undone.project.document.tracks == []
    assert undone.revision.summary == "Undo change from version 2"


async def test_time_signature_is_versioned_and_undoable_without_moving_clips(session):
    from copy import deepcopy

    from pydantic import ValidationError

    from app.schemas.command import SetTimeSignature

    project = await create_project(session, ProjectCreate(name="Meter"))
    await apply_command(session, project, CommandRequest(expected_version=1, command=AddTrack(name="Drums")))
    track_id = project.document["tracks"][0]["id"]
    await apply_command(
        session,
        project,
        CommandRequest(
            expected_version=2,
            command=AddClip(
                track_id=track_id,
                name="Beat",
                start_beat=8,
                length_beats=4,
            ),
        ),
    )
    original_tracks = deepcopy(project.document["tracks"])
    result = await apply_command(
        session,
        project,
        CommandRequest(
            expected_version=3,
            command=SetTimeSignature(time_signature="6/8"),
        ),
    )
    assert result.project.document.time_signature == "6/8"
    assert project.document["tracks"] == original_tracks
    with pytest.raises(VersionConflictError):
        await apply_command(
            session,
            project,
            CommandRequest(
                expected_version=3,
                command=SetTimeSignature(time_signature="3/4"),
            ),
        )
    restored = await undo_last_change(session, project, expected_version=4)
    assert restored.project.document.time_signature == "4/4"
    assert project.document["tracks"] == original_tracks
    for invalid in ["0/4", "33/4", "4/3", "4/0", "bad"]:
        with pytest.raises(ValidationError):
            SetTimeSignature(time_signature=invalid)
