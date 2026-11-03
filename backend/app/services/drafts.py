"""Validated editing workspaces, isolated from explicitly saved projects."""

from copy import deepcopy

from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidCommandError, VersionConflictError
from app.models.project import Asset, Operation, Project, new_id, utcnow
from app.schemas.document import ProjectDocument
from app.schemas.project import ProjectRead
from app.services.history import changes, read_project
from app.services.project import get_project


class SaveDraftRequest(BaseModel):
    expected_version: int = Field(ge=1)
    save_as: bool = False
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SaveDraftResult(BaseModel):
    project: ProjectRead
    saved_project_id: str


async def clone_document(session: AsyncSession, source: Project, destination_id: str) -> dict:
    document = ProjectDocument.model_validate(source.document).model_dump(mode="json")
    refs = {s["asset_id"] for s in document["sources"] if s["asset_id"]}
    refs.update(r["asset_id"] for s in document["sources"] for r in s["drum_samples"])
    refs.update(c["asset_id"] for t in document["tracks"] for c in t["clips"] if c["asset_id"])
    assets = (
        list(
            (
                await session.scalars(
                    select(Asset).where(
                        Asset.project_id == source.id,
                        Asset.id.in_(refs),
                    )
                )
            ).all()
        )
        if refs
        else []
    )
    if len(assets) != len(refs):
        raise InvalidCommandError("Draft media is missing.")
    mapping = {asset.id: new_id() for asset in assets}
    for asset in assets:
        session.add(
            Asset(
                id=mapping[asset.id],
                project_id=destination_id,
                kind=asset.kind,
                filename=asset.filename,
                content_type=asset.content_type,
                size_bytes=asset.size_bytes,
                storage_key=asset.storage_key,
            )
        )
    for s in document["sources"]:
        if s["asset_id"]:
            s["asset_id"] = mapping[s["asset_id"]]
        for row in s["drum_samples"]:
            row["asset_id"] = mapping[row["asset_id"]]
    for track in document["tracks"]:
        for clip in track["clips"]:
            if clip["asset_id"]:
                clip["asset_id"] = mapping[clip["asset_id"]]
    return document


async def open_draft(session: AsyncSession, project_id: str) -> ProjectRead:
    original = await get_project(session, project_id)
    if original.is_draft:
        raise InvalidCommandError("This workspace is already a draft.")
    draft = Project(
        id=new_id(),
        name=original.name,
        document={},
        version=1,
        is_draft=True,
        draft_base_id=original.id,
        draft_base_version=original.version,
    )
    session.add(draft)
    await session.flush()
    draft.document = await clone_document(session, original, draft.id)
    draft.draft_checkpoint = {"name": draft.name, "document": deepcopy(draft.document)}
    session.add(
        Operation(project_id=draft.id, version=1, summary="Draft opened", baseline=True, forward=[], inverse=[])
    )
    await session.commit()
    return await read_project(session, draft)


async def save_draft(session: AsyncSession, draft_id: str, payload: SaveDraftRequest) -> SaveDraftResult:
    draft = await get_project(session, draft_id)
    if not draft.is_draft:
        raise InvalidCommandError("Open an editing draft before saving.")
    if draft.version != payload.expected_version:
        raise VersionConflictError(draft.version)
    if not payload.save_as and (draft.draft_example_id or not draft.draft_base_id):
        raise InvalidCommandError("Examples can only be saved with Save as.")
    name = (payload.name or draft.name).strip() if payload.save_as else draft.name
    if not name:
        raise InvalidCommandError("A project name is required.")
    try:
        if payload.save_as:
            target = Project(id=new_id(), name=name, document={}, version=1)
            session.add(target)
            await session.flush()
            document = await clone_document(session, draft, target.id)
            target.document = document
            session.add(
                Operation(
                    project_id=target.id, version=1, summary="Project saved", baseline=True, forward=[], inverse=[]
                )
            )
            target_version = 1
        else:
            target = await get_project(session, draft.draft_base_id)
            if target.is_draft or target.version != draft.draft_base_version:
                raise VersionConflictError(target.version)
            if draft.draft_checkpoint == {"name": draft.name, "document": draft.document}:
                return SaveDraftResult(project=await read_project(session, draft), saved_project_id=target.id)
            document = await clone_document(session, draft, target.id)
            before = {"name": target.name, "document": target.document}
            after = {"name": name, "document": document}
            expected = target.version
            result = await session.execute(
                update(Project)
                .where(Project.id == target.id, Project.version == expected)
                .values(name=name, document=document, version=expected + 1, updated_at=utcnow())
                .returning(Project.id),
                execution_options={"synchronize_session": False},
            )
            if result.scalar_one_or_none() is None:
                raise VersionConflictError(expected)
            target_version = expected + 1
            session.add(
                Operation(
                    project_id=target.id,
                    version=target_version,
                    summary="Project saved",
                    forward=changes(before, after),
                    inverse=changes(after, before),
                )
            )
        result = await session.execute(
            update(Project)
            .where(
                Project.id == draft.id,
                Project.version == payload.expected_version,
            )
            .values(
                version=payload.expected_version + 1,
                name=name,
                draft_base_id=target.id,
                draft_base_version=target_version,
                draft_example_id=None,
                draft_checkpoint={"name": name, "document": deepcopy(draft.document)},
                updated_at=utcnow(),
            )
            .returning(Project.id),
            execution_options={"synchronize_session": False},
        )
        if result.scalar_one_or_none() is None:
            raise VersionConflictError(draft.version)
        session.add(
            Operation(
                project_id=draft.id,
                version=payload.expected_version + 1,
                summary="Draft saved",
                baseline=True,
                forward=[],
                inverse=[],
            )
        )
        await session.flush()
        await session.refresh(draft)
        await session.refresh(target)
        response = await read_project(session, draft)
        await session.commit()
        return SaveDraftResult(project=response, saved_project_id=target.id)
    except Exception:
        await session.rollback()
        raise
