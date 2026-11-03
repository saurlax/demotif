import asyncio
import json
from copy import deepcopy

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import InvalidCommandError, VersionConflictError
from app.db.base import Base
from app.db.migrations import backup_database, migrate_history
from app.models.project import Operation, Project, Revision
from app.schemas.command import (
    AddClip,
    AddTrack,
    CommandRequest,
    MoveClip,
    RemoveClip,
    RemoveTrack,
    RenameProject,
    SetTempo,
    SetTrackLock,
)
from app.schemas.document import Clip, ProjectDocument, Track
from app.schemas.project import ProjectCreate
from app.services.command import apply_command, undo_last_change
from app.services.history import changes, read_project, restore
from app.services.project import create_project, list_revisions


async def edit(session, project, command):
    return await apply_command(session, project, CommandRequest(expected_version=project.version, command=command))


async def test_all_commands_and_sequential_undo(session):
    project = await create_project(session, ProjectCreate(name="Original"))
    states = [(project.name, deepcopy(project.document))]
    await edit(session, project, AddTrack(name="First"))
    track_id = project.document["tracks"][0]["id"]
    await edit(session, project, AddTrack(name="Second"))
    # Undo the second addition so subsequent history also covers edit-after-undo.
    await undo_last_change(session, project, project.version)
    states.append((project.name, deepcopy(project.document)))
    commands = [
        RenameProject(name="Renamed"),
        SetTempo(tempo=90),
        SetTrackLock(track_id=track_id, locked=True),
        SetTrackLock(track_id=track_id, locked=False),
        AddClip(track_id=track_id, name="Part"),
    ]
    for command in commands:
        await edit(session, project, command)
        states.append((project.name, deepcopy(project.document)))
    clip_id = project.document["tracks"][0]["clips"][0]["id"]
    for command in [
        MoveClip(track_id=track_id, clip_id=clip_id, start_beat=8),
        RemoveClip(track_id=track_id, clip_id=clip_id),
    ]:
        await edit(session, project, command)
        states.append((project.name, deepcopy(project.document)))
    # Restore the deleted clip, then remove its entire parent track.
    await undo_last_change(session, project, project.version)
    states.pop()
    await edit(session, project, RemoveTrack(track_id=track_id))
    assert project.document["tracks"] == []
    await undo_last_change(session, project, project.version)
    assert (project.name, project.document) == states[-1]
    for expected in reversed(states[:-1]):
        result = await undo_last_change(session, project, project.version)
        assert (result.project.name, result.project.document.model_dump(mode="json")) == expected
    assert not (await read_project(session, project)).can_undo
    count = await session.scalar(select(func.count()).select_from(Operation))
    with pytest.raises(InvalidCommandError, match="Nothing to undo"):
        await undo_last_change(session, project, project.version)
    assert await session.scalar(select(func.count()).select_from(Operation)) == count
    assert await session.scalar(select(func.count()).select_from(Revision)) == 0
    assert len(await list_revisions(session, project.id)) == count


def test_deltas_restore_order_nulls_and_only_affected_subtrees():
    before = {
        "name": "Song",
        "document": ProjectDocument(
            tracks=[
                Track(id="a", name="A", clips=[Clip(id="c")]),
                Track(id="b", name="B"),
            ]
        ).model_dump(mode="json"),
    }
    after = deepcopy(before)
    after["document"]["tracks"].reverse()
    after["document"]["tracks"][1]["clips"][0]["color"] = "#ffffff"
    after["document"]["tracks"][1]["name"] = "Changed"
    assert restore(before, changes(before, after)) == after
    assert restore(after, changes(after, before)) == before
    removed = deepcopy(after)
    removed["document"]["tracks"].pop()
    payload = changes(removed, after)
    assert '"b"' not in json.dumps(payload)
    assert restore(removed, payload) == after


@pytest.mark.parametrize("track_count", [1, 1000])
async def test_lock_history_size_is_independent_of_project(session, track_count):
    project = await create_project(session, ProjectCreate(name="Large"))
    project.document = ProjectDocument(
        tracks=[
            Track(id=f"{index:032x}", name=f"Track {index}", clips=[Clip(name="Unrelated")])
            for index in range(track_count)
        ]
    ).model_dump(mode="json")
    await session.commit()
    await edit(session, project, SetTrackLock(track_id=f"{0:032x}", locked=True))
    operation = await session.scalar(select(Operation).where(Operation.version == 2))
    assert operation.forward == [{"op": "set", "path": ["document", "tracks", f"{0:032x}", "locked"], "value": True}]
    assert operation.inverse[0]["value"] is False
    assert len(json.dumps(operation.forward)) < 150
    assert await session.scalar(select(func.count()).select_from(Revision)) == 0


@pytest_asyncio.fixture
async def file_db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'history.db'}"
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield engine, async_sessionmaker(engine, expire_on_commit=False), url
    await engine.dispose()


async def test_two_independent_sessions_reject_stale_loaded_document(file_db):
    _, maker, _ = file_db
    async with maker() as session:
        project = await create_project(session, ProjectCreate())
        project_id = project.id
    async with maker() as first, maker() as second:
        a, b = await first.get(Project, project_id), await second.get(Project, project_id)
        await edit(first, a, SetTempo(tempo=90))
        with pytest.raises(VersionConflictError):
            await edit(second, b, SetTempo(tempo=100))
    async with maker() as session:
        current = await session.get(Project, project_id)
        assert current.version == 2 and current.document["tempo"] == 90
        assert await session.scalar(select(func.count()).select_from(Operation)) == 2
        assert (await read_project(session, current)).can_undo
        await undo_last_change(session, current, current.version)
    async with maker() as session:
        current = await session.get(Project, project_id)
        assert current.document["tempo"] == 120
        assert not (await read_project(session, current)).can_undo


async def test_concurrent_writers_and_stale_undo(file_db):
    _, maker, _ = file_db
    async with maker() as session:
        project = await create_project(session, ProjectCreate())
        project_id = project.id
    async with maker() as a, maker() as b:
        pa, pb = await a.get(Project, project_id), await b.get(Project, project_id)
        results = await asyncio.gather(
            edit(a, pa, SetTempo(tempo=80)),
            edit(b, pb, SetTempo(tempo=95)),
            return_exceptions=True,
        )
        assert sum(isinstance(item, VersionConflictError) for item in results) == 1
    async with maker() as session:
        current = await session.get(Project, project_id)
        with pytest.raises(VersionConflictError):
            await undo_last_change(session, current, expected_version=1)
        assert current.version == 2
        assert await session.scalar(select(func.count()).select_from(Operation)) == 2


async def seed_legacy(session):
    documents = [ProjectDocument().model_dump(mode="json")]
    documents.append(
        ProjectDocument(tracks=[Track(id="old-track", clips=[Clip(id="old-clip")])]).model_dump(mode="json")
    )
    documents.append(deepcopy(documents[-1]))
    documents.append(ProjectDocument().model_dump(mode="json"))
    documents.append(deepcopy(documents[2]))  # Old snapshot undo transition.
    project = Project(name="Renamed", version=5, document=documents[-1])
    session.add(project)
    await session.flush()
    for index, document in enumerate(documents):
        session.add(
            Revision(
                project_id=project.id,
                version=index + 1,
                name="Original" if index < 2 else "Renamed",
                document=document,
                summary="Undo change from version 4" if index == 4 else f"Legacy edit {index}",
            )
        )
    await session.commit()
    return project.id, documents


async def test_legacy_backup_migration_restart_and_undo(file_db):
    _, maker, url = file_db
    async with maker() as session:
        project_id, documents = await seed_legacy(session)
    backup = backup_database(url)
    assert backup and backup.is_file()
    async with maker() as session:
        await migrate_history(session)
        await migrate_history(session)
        project = await session.get(Project, project_id)
        assert project.version == 5 and project.document == documents[-1]
        assert await session.scalar(select(func.count()).select_from(Operation)) == 5
        assert await session.scalar(select(func.count()).select_from(Revision)) == 5
        assert len(await list_revisions(session, project_id)) == 5
        for expected in reversed(documents[:-1]):
            await undo_last_change(session, project, project.version)
            assert project.document == expected
        assert project.name == "Original"
        assert not (await read_project(session, project)).can_undo
        await edit(session, project, SetTempo(tempo=80))
        assert await session.scalar(select(func.count()).select_from(Revision)) == 5
    assert backup_database(url) is None
    async with maker() as session:
        await migrate_history(session)
        project = await session.get(Project, project_id)
        assert project.document["tempo"] == 80


async def test_corrupt_or_interrupted_migration_is_atomic(file_db, monkeypatch):
    from app.db import migrations

    _, maker, _ = file_db
    async with maker() as session:
        project_id, documents = await seed_legacy(session)
        original = migrations.changes
        calls = 0

        def interrupted(*args):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise RuntimeError("simulated interruption")
            return original(*args)

        monkeypatch.setattr(migrations, "changes", interrupted)
        with pytest.raises(RuntimeError, match="interruption"):
            await migrate_history(session)
        assert await session.scalar(select(func.count()).select_from(Operation)) == 0
        monkeypatch.setattr(migrations, "changes", original)
        project = await session.get(Project, project_id)
        project.name = "Out of sync"
        await session.commit()
        with pytest.raises(RuntimeError, match="differs from current state"):
            await migrate_history(session)
        assert await session.scalar(select(func.count()).select_from(Operation)) == 0
        await session.refresh(project)
        project.name = "Renamed"
        await session.commit()
        await migrate_history(session)
        assert project.document == documents[-1]
        assert await session.scalar(select(func.count()).select_from(Operation)) == 5


async def test_failed_commit_path_leaves_state_and_history_unchanged(session, monkeypatch):
    from app.services import command as service

    project = await create_project(session, ProjectCreate())
    project_id = project.id

    async def fail_read(*args):
        raise RuntimeError("response construction failed")

    monkeypatch.setattr(service, "read_project", fail_read)
    with pytest.raises(RuntimeError, match="response construction failed"):
        await edit(session, project, SetTempo(tempo=80))
    await session.refresh(project)
    assert project.version == 1 and project.document["tempo"] == 120
    assert (
        await session.scalar(select(func.count()).select_from(Operation).where(Operation.project_id == project_id)) == 1
    )


async def test_missing_legacy_revision_aborts_without_partial_conversion(file_db):
    from sqlalchemy import delete

    _, maker, _ = file_db
    async with maker() as session:
        await seed_legacy(session)
        await session.execute(delete(Revision).where(Revision.version == 3))
        await session.commit()
        with pytest.raises(RuntimeError, match="missing revisions"):
            await migrate_history(session)
        assert await session.scalar(select(func.count()).select_from(Operation)) == 0
