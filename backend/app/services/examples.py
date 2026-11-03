"""Local example packs create independent, editable project instances."""

import asyncio
import hashlib
import re
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage.local import LocalBlobStore
from app.core.errors import InvalidCommandError, NotFoundError
from app.models.project import Asset, Operation, Project, new_id
from app.schemas.document import ProjectDocument
from app.schemas.project import ProjectRead
from app.services.history import read_project


class ExampleMedia(BaseModel):
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    filename: str
    file: str


class ExamplePack(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    document: ProjectDocument
    media: list[ExampleMedia] = Field(default_factory=list)


class ExampleSummary(BaseModel):
    id: str
    name: str
    tempo: float
    tracks: int


def read_pack(root: Path, example_id: str) -> tuple[Path, ExamplePack]:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", example_id) or example_id == "groove":
        raise NotFoundError("Example not found")
    directory = (root / example_id).resolve()
    if not directory.is_relative_to(root.resolve()) or not (directory / "manifest.json").is_file():
        raise NotFoundError("Example not found")
    try:
        pack = ExamplePack.model_validate_json((directory / "manifest.json").read_text())
        ids = [media.id for media in pack.media]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate media")
        refs = {source.asset_id for source in pack.document.sources if source.asset_id}
        refs.update(row.asset_id for source in pack.document.sources for row in source.drum_samples)
        refs.update(clip.asset_id for track in pack.document.tracks for clip in track.clips if clip.asset_id)
        if not refs.issubset(set(ids)):
            raise ValueError("Missing media")
        for media in pack.media:
            path = (directory / media.file).resolve()
            if not path.is_relative_to(directory) or not path.is_file():
                raise ValueError("Missing media")
        return directory, pack
    except (ValueError, ValidationError, OSError) as exc:
        raise InvalidCommandError("Example files are incomplete or invalid.") from exc


def list_examples(root: Path) -> list[ExampleSummary]:
    examples = [ExampleSummary(id="groove", name="Pocket groove", tempo=112, tracks=3)]
    if root.is_dir():
        for directory in sorted(root.iterdir()):
            if not directory.is_dir() or directory.name == "groove":
                continue
            try:
                _, pack = read_pack(root, directory.name)
            except (NotFoundError, InvalidCommandError):
                continue
            examples.append(
                ExampleSummary(
                    id=directory.name, name=pack.name, tempo=pack.document.tempo, tracks=len(pack.document.tracks)
                )
            )
    return examples


def prepare_media(directory: Path, pack: ExamplePack, storage: LocalBlobStore) -> list[dict]:
    result = []
    # Validate every source before writing anything or creating a project.
    payloads = [(media, (directory / media.file).read_bytes()) for media in pack.media]
    if any(hashlib.sha256(data).hexdigest() != media.id for media, data in payloads):
        raise InvalidCommandError("Example audio failed its integrity check.")
    for media, data in payloads:
        suffix = Path(media.file).suffix.lower()
        if suffix not in {".wav", ".mp3", ".ogg", ".flac", ".m4a"}:
            raise InvalidCommandError("Unsupported example audio format.")
        key = f"examples/{media.id}{suffix}"
        target = storage.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != media.id:
            temporary = target.with_name(f"{target.name}.{new_id()}.tmp")
            try:
                temporary.write_bytes(data)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        result.append(
            {
                "id": media.id,
                "storage_key": key,
                "filename": Path(media.filename).name,
                "content_type": {
                    ".wav": "audio/wav",
                    ".mp3": "audio/mpeg",
                    ".ogg": "audio/ogg",
                    ".flac": "audio/flac",
                    ".m4a": "audio/mp4",
                }[suffix],
                "size_bytes": len(data),
            }
        )
    return result


async def create_example(session: AsyncSession, storage: LocalBlobStore, root: Path, example_id: str) -> ProjectRead:
    directory, pack = await asyncio.to_thread(read_pack, root, example_id)
    media = await asyncio.to_thread(prepare_media, directory, pack, storage)
    document = pack.document.model_dump(mode="json")
    mapping = {item["id"]: new_id() for item in media}
    for source in document["sources"]:
        if source["asset_id"]:
            source["asset_id"] = mapping[source["asset_id"]]
        for row in source["drum_samples"]:
            row["asset_id"] = mapping[row["asset_id"]]
    for track in document["tracks"]:
        for clip in track["clips"]:
            if clip["asset_id"]:
                clip["asset_id"] = mapping[clip["asset_id"]]
    project = Project(
        name=pack.name,
        document=document,
        version=1,
        is_draft=True,
        draft_example_id=example_id,
        draft_checkpoint={"name": pack.name, "document": document},
    )
    session.add(project)
    await session.flush()
    for item in media:
        session.add(Asset(**{**item, "id": mapping[item["id"]]}, project_id=project.id, kind="sample"))
    session.add(
        Operation(project_id=project.id, version=1, summary="Example loaded", baseline=True, forward=[], inverse=[])
    )
    await session.commit()
    return await read_project(session, project)
