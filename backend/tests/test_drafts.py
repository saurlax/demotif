from copy import deepcopy

import pytest
from sqlalchemy import select

from app.core.errors import InvalidCommandError, VersionConflictError
from app.models.project import Asset, Project
from app.schemas.command import CommandRequest, SetTempo
from app.schemas.project import ProjectCreate
from app.services.command import apply_command, undo_last_change
from app.services.drafts import SaveDraftRequest, open_draft, save_draft
from app.services.history import read_project
from app.services.project import create_project, list_projects


async def edit_tempo(session, draft, tempo):
    row = await session.get(Project, draft.id)
    return (
        await apply_command(
            session,
            row,
            CommandRequest(
                expected_version=draft.version,
                command=SetTempo(tempo=tempo),
            ),
        )
    ).project


async def test_regular_edits_only_change_draft_until_explicit_save(session):
    original = await create_project(session, ProjectCreate(name="Saved", tempo=120))
    first = await open_draft(session, original.id)
    second = await open_draft(session, original.id)
    assert first.id != second.id and first.draft_base_id == original.id
    assert not first.has_unsaved_changes
    edited = await edit_tempo(session, first, 100)
    assert edited.has_unsaved_changes
    await session.refresh(original)
    assert original.document["tempo"] == 120 and original.version == 1
    assert [p.id for p in await list_projects(session)] == [original.id]
    saved = await save_draft(session, first.id, SaveDraftRequest(expected_version=edited.version))
    assert saved.saved_project_id == original.id
    assert not saved.project.has_unsaved_changes
    await session.refresh(original)
    assert original.document["tempo"] == 100 and original.version == 2
    # The other tab is not silently replaced; its older base version cannot overwrite this save.
    stale = await edit_tempo(session, second, 80)
    with pytest.raises(VersionConflictError):
        await save_draft(session, second.id, SaveDraftRequest(expected_version=stale.version))
    row = await session.get(Project, second.id)
    assert (await read_project(session, row)).has_unsaved_changes
    assert row.document["tempo"] == 80
    copied = await save_draft(
        session,
        second.id,
        SaveDraftRequest(
            expected_version=row.version,
            save_as=True,
            name="Separate",
        ),
    )
    await session.refresh(original)
    assert copied.saved_project_id != original.id
    assert not copied.project.has_unsaved_changes
    assert {p.name for p in await list_projects(session)} == {"Saved", "Separate"}


async def test_example_only_save_as_and_undo_restores_clean_checkpoint(session):
    example = await create_project(session, ProjectCreate(name="Example"), is_draft=True, example_id="test")
    initial = await read_project(session, example)
    assert await list_projects(session) == [] and not initial.has_unsaved_changes
    edited = await edit_tempo(session, initial, 90)
    with pytest.raises(InvalidCommandError, match="Save as"):
        await save_draft(session, example.id, SaveDraftRequest(expected_version=edited.version))
    restored = (await undo_last_change(session, example, edited.version)).project
    assert not restored.has_unsaved_changes
    saved = await save_draft(
        session,
        example.id,
        SaveDraftRequest(
            expected_version=restored.version,
            save_as=True,
            name="My song",
        ),
    )
    assert saved.project.draft_example_id is None
    assert saved.project.name == "My song" and not saved.project.has_unsaved_changes
    changed = await edit_tempo(session, saved.project, 88)
    await save_draft(session, example.id, SaveDraftRequest(expected_version=changed.version))
    projects = await list_projects(session)
    assert len(projects) == 1 and projects[0].document["tempo"] == 88


async def test_draft_media_survives_save_as_with_independent_ownership(session):
    original = await create_project(session, ProjectCreate(name="Audio"))
    asset = Asset(
        id="sample",
        project_id=original.id,
        kind="sample",
        filename="kick.wav",
        storage_key="immutable/kick.wav",
        content_type="audio/wav",
        size_bytes=100,
    )
    session.add(asset)
    original.document = {
        **original.document,
        "sources": [{"id": "voice", "name": "Voice", "kind": "audio", "duration": 2, "asset_id": "sample"}],
    }
    await session.commit()
    before = deepcopy(original.document)
    draft = await open_draft(session, original.id)
    draft_asset = draft.document.sources[0].asset_id
    assert draft_asset != "sample"
    result = await save_draft(
        session,
        draft.id,
        SaveDraftRequest(
            expected_version=draft.version,
            save_as=True,
            name="Audio copy",
        ),
    )
    copy = await session.get(Project, result.saved_project_id)
    copied_id = copy.document["sources"][0]["asset_id"]
    assert copied_id not in {"sample", draft_asset}
    assert (await session.get(Asset, copied_id)).project_id == copy.id
    assert (await session.get(Asset, copied_id)).storage_key == "immutable/kick.wav"
    await session.refresh(original)
    assert original.document == before
    assert len(list((await session.scalars(select(Asset))).all())) == 3


async def test_existing_database_gains_draft_columns_without_changing_saved_data(tmp_path):
    import sqlite3

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.db.migrations import backup_database, upgrade_drafts

    path = tmp_path / "existing.db"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, version INTEGER, document JSON)")
        connection.execute("INSERT INTO projects VALUES ('saved', 'Keep', 7, '{}')")
    url = f"sqlite+aiosqlite:///{path}"
    assert backup_database(url).is_file()
    engine = create_async_engine(url)
    try:
        await upgrade_drafts(engine)
        await upgrade_drafts(engine)
        async with engine.connect() as connection:
            row = (await connection.execute(text("SELECT name, version, document, is_draft FROM projects"))).one()
            assert tuple(row) == ("Keep", 7, "{}", 0)
    finally:
        await engine.dispose()


async def test_builtin_example_opens_clean_unlisted_draft(session):
    from app.api.routes.projects import create_example

    example = await create_example(session)
    assert example.is_draft and example.draft_example_id == "groove"
    assert not example.has_unsaved_changes and not example.can_undo
    assert len(example.document.tracks) == 3
    assert await list_projects(session) == []
