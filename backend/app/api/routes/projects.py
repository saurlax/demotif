from fastapi import APIRouter

from app.api.deps import SessionDep, StorageDep
from app.core.config import get_settings
from app.schemas.command import UndoResult
from app.schemas.project import ProjectCreate, ProjectRead, ProjectSummary, RevisionRead, UndoRequest
from app.services import command as command_service
from app.services import examples as example_service
from app.services import project as project_service
from app.services.history import read_project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectRead, status_code=201)
async def create_project(payload: ProjectCreate, session: SessionDep) -> ProjectRead:
    project = await project_service.create_project(session, payload)
    return await read_project(session, project)


@router.get("", response_model=list[ProjectSummary])
async def list_projects(session: SessionDep) -> list[ProjectSummary]:
    projects = await project_service.list_projects(session)
    return [ProjectSummary.model_validate(project) for project in projects]


@router.get("/examples", response_model=list[example_service.ExampleSummary])
async def list_examples() -> list[example_service.ExampleSummary]:
    import asyncio

    return await asyncio.to_thread(example_service.list_examples, get_settings().examples_root)


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: str, session: SessionDep) -> ProjectRead:
    project = await project_service.get_project(session, project_id)
    return await read_project(session, project)


@router.get("/{project_id}/revisions", response_model=list[RevisionRead])
async def list_revisions(project_id: str, session: SessionDep) -> list[RevisionRead]:
    await project_service.get_project(session, project_id)
    revisions = await project_service.list_revisions(session, project_id)
    return [RevisionRead.model_validate(revision) for revision in revisions]


@router.post("/{project_id}/undo", response_model=UndoResult)
async def undo(project_id: str, payload: UndoRequest, session: SessionDep) -> UndoResult:
    project = await project_service.get_project(session, project_id)
    return await command_service.undo_last_change(session, project, payload.expected_version)


@router.post("/{project_id}/copy", response_model=ProjectRead, status_code=201)
async def copy_project(project_id: str, session: SessionDep) -> ProjectRead:
    from copy import deepcopy

    from sqlalchemy import select

    from app.models.project import Asset, Operation, Project, new_id

    original = await project_service.get_project(session, project_id)
    copied = Project(name=f"{original.name} copy", document=deepcopy(original.document), version=1)
    session.add(copied)
    await session.flush()
    assets = (await session.scalars(select(Asset).where(Asset.project_id == project_id))).all()
    mapping = {}
    for asset in assets:
        new = Asset(
            id=new_id(),
            project_id=copied.id,
            kind=asset.kind,
            filename=asset.filename,
            content_type=asset.content_type,
            size_bytes=asset.size_bytes,
            storage_key=asset.storage_key,
        )
        mapping[asset.id] = new.id
        session.add(new)
    document = deepcopy(original.document)
    for source in document.get("sources", []):
        if source.get("asset_id"):
            source["asset_id"] = mapping[source["asset_id"]]
        for row in source.get("drum_samples", []):
            row["asset_id"] = mapping[row["asset_id"]]
    for track in document.get("tracks", []):
        for clip in track.get("clips", []):
            if clip.get("asset_id"):
                clip["asset_id"] = mapping.get(clip["asset_id"], clip["asset_id"])
    copied.document = document
    session.add(
        Operation(project_id=copied.id, version=1, summary="Project copied", baseline=True, forward=[], inverse=[])
    )
    await session.commit()
    return await read_project(session, copied)


from pydantic import BaseModel, Field

from app.schemas.document import ProjectDocument


class ImportProject(BaseModel):
    name: str = Field(default="Imported project", min_length=1, max_length=200)
    document: ProjectDocument


@router.post("/import", response_model=ProjectRead, status_code=201)
async def import_project(payload: ImportProject, session: SessionDep) -> ProjectRead:
    """Import a validated project document into a new local project."""
    from sqlalchemy import select

    from app.core.errors import InvalidCommandError
    from app.models.project import Asset, Operation, Project, new_id

    document = payload.document.model_dump(mode="json")
    refs = {s.asset_id for s in payload.document.sources if s.asset_id}
    refs.update(r.asset_id for s in payload.document.sources for r in s.drum_samples)
    refs.update(c.asset_id for t in payload.document.tracks for c in t.clips if c.asset_id)
    media = (await session.scalars(select(Asset).where(Asset.id.in_(refs)))).all() if refs else []
    if len(media) != len(refs):
        raise InvalidCommandError("Referenced audio is not available on this workspace. Import the audio files first.")
    project = Project(name=payload.name, document={}, version=1)
    session.add(project)
    await session.flush()
    mapping = {}
    for old in media:
        asset = Asset(
            id=new_id(),
            project_id=project.id,
            kind=old.kind,
            filename=old.filename,
            content_type=old.content_type,
            size_bytes=old.size_bytes,
            storage_key=old.storage_key,
        )
        mapping[old.id] = asset.id
        session.add(asset)
    for source in document["sources"]:
        if source["asset_id"]:
            source["asset_id"] = mapping[source["asset_id"]]
        for row in source["drum_samples"]:
            row["asset_id"] = mapping[row["asset_id"]]
    for track in document["tracks"]:
        for clip in track["clips"]:
            if clip["asset_id"]:
                clip["asset_id"] = mapping[clip["asset_id"]]
    project.document = document
    session.add(
        Operation(project_id=project.id, version=1, summary="Project imported", baseline=True, forward=[], inverse=[])
    )
    await session.commit()
    return await read_project(session, project)


@router.post("/examples/groove", response_model=ProjectRead, status_code=201)
async def create_example(session: SessionDep) -> ProjectRead:
    from app.schemas.command import BatchRequest
    from app.schemas.document import Note, Part, Source, new_id

    project = await project_service.create_project(
        session,
        ProjectCreate(name="Pocket groove", tempo=112),
        is_draft=True,
        example_id="groove",
    )
    commands = []
    for name, kind, sound in [
        ("Drums", "drums", "piano"),
        ("Bass", "notes", "electric-bass"),
        ("Keys", "notes", "electric-piano"),
    ]:
        source = Source(name=name, kind=kind, sound=sound, duration=16)
        for bar in range(4):
            if kind == "drums":
                source.notes.extend(
                    Note(pitch=p, start=bar * 4 + b, duration=0.2, velocity=v)
                    for p, b, v in [
                        (36, 0, 0.9),
                        (36, 2, 0.8),
                        (38, 1, 0.8),
                        (38, 3, 0.85),
                        *[(42, i * 0.5, 0.5 if i % 2 else 0.65) for i in range(8)],
                    ]
                )
            elif name == "Bass":
                source.notes.extend(
                    Note(
                        pitch=[36, 41, 33, 43][bar],
                        start=bar * 4 + b,
                        duration=min(0.7, 16 - (bar * 4 + b)),
                        velocity=0.75,
                    )
                    for b in [0, 1.5, 2.5, 3.5]
                )
            else:
                source.notes.extend(
                    Note(pitch=p, start=bar * 4 + b, duration=0.8, velocity=0.55)
                    for p in [[60, 63, 67], [65, 68, 72], [57, 60, 64], [67, 70, 74]][bar]
                    for b in [0, 1.5, 3]
                )
        track_id = new_id()
        commands.extend(
            [
                {"type": "source.add", "source": source.model_dump(mode="json")},
                {"type": "part.add", "part": Part(name=name, source_id=source.id, duration=16).model_dump(mode="json")},
                {
                    "type": "track.add",
                    "id": track_id,
                    "name": name,
                    "kind": "drums" if kind == "drums" else "instrument",
                },
                {
                    "type": "clip.add",
                    "track_id": track_id,
                    "name": name,
                    "kind": "midi",
                    "source_id": source.id,
                    "length_beats": 16,
                    "source_duration": 16,
                },
            ]
        )
    await command_service.apply_batch(
        session, project, BatchRequest(request_id=new_id(), expected_version=1, commands=commands)
    )
    from sqlalchemy import update

    from app.models.project import Operation

    await session.execute(update(Operation).where(Operation.project_id == project.id).values(baseline=True))
    project.draft_checkpoint = {"name": project.name, "document": project.document}
    await session.commit()
    return await read_project(session, project)


@router.post("/examples/{example_id}", response_model=ProjectRead, status_code=201)
async def load_example(example_id: str, session: SessionDep, storage: StorageDep) -> ProjectRead:
    return await example_service.create_example(session, storage, get_settings().examples_root, example_id)


from app.services import drafts as draft_service


@router.post("/{project_id}/drafts", response_model=ProjectRead, status_code=201)
async def open_draft(project_id: str, session: SessionDep) -> ProjectRead:
    return await draft_service.open_draft(session, project_id)


@router.post("/{project_id}/save", response_model=draft_service.SaveDraftResult)
async def save_draft(project_id: str, payload: draft_service.SaveDraftRequest, session: SessionDep):
    return await draft_service.save_draft(session, project_id, payload)
