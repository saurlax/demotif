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
