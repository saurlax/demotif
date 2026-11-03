import re
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import SessionDep, StorageDep
from app.core.errors import ApiError, NotFoundError
from app.models.project import Asset, new_id
from app.schemas.asset import AssetRead
from app.services import project as project_service

router = APIRouter(prefix="/projects/{project_id}/assets", tags=["assets"])

ALLOWED_KINDS = {"recording", "vocal", "instrument", "sample", "reference"}


def _suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ""


@router.post("", response_model=AssetRead, status_code=201)
async def upload_asset(
    project_id: str,
    session: SessionDep,
    storage: StorageDep,
    kind: Annotated[str, Form()] = "recording",
    file: Annotated[UploadFile, File()] = ...,
) -> AssetRead:
    if kind not in ALLOWED_KINDS:
        raise ApiError(422, "invalid_kind", f"kind must be one of {sorted(ALLOWED_KINDS)}")
    if not (file.content_type or "").startswith(("audio/", "video/")):
        raise ApiError(415, "unsupported_media", "Only audio or video uploads are supported")
    await project_service.get_project(session, project_id)

    asset_id = new_id()
    key = f"{project_id}/{asset_id}{_suffix(file.filename or '')}"
    size = await storage.save(key, file)

    asset = Asset(
        id=asset_id,
        project_id=project_id,
        kind=kind,
        filename=Path(file.filename or "upload").name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        storage_key=key,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return AssetRead.model_validate(asset)


@router.get("", response_model=list[AssetRead])
async def list_assets(project_id: str, session: SessionDep) -> list[AssetRead]:
    await project_service.get_project(session, project_id)
    result = await session.execute(
        select(Asset).where(Asset.project_id == project_id).order_by(Asset.created_at.desc())
    )
    return [AssetRead.model_validate(asset) for asset in result.scalars()]


@router.get("/{asset_id}/content")
async def download_asset(project_id: str, asset_id: str, session: SessionDep, storage: StorageDep) -> FileResponse:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.project_id != project_id:
        raise NotFoundError("Asset not found")
    path = storage.path(asset.storage_key)
    if not path.is_file():
        raise NotFoundError("Asset content is missing from local storage")
    return FileResponse(path, media_type=asset.content_type, filename=asset.filename)
