import json
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import SessionDep, StorageDep
from app.core.errors import NotFoundError
from app.models.project import Asset, new_id
from app.schemas.document import Sampler, Source
from app.services.project import get_project

ROOT = Path(__file__).resolve().parents[3] / "resources" / "sounds"
CATALOG = json.loads((ROOT / "catalog.json").read_text())
router = APIRouter(tags=["sounds"])


@router.get("/sounds")
async def sounds() -> dict:
    return {
        "entries": [
            {
                **{k: v for k, v in e.items() if k != "file"},
                **({"preview_url": f"/api/sounds/{e['id']}/preview"} if e.get("file") else {}),
            }
            for e in CATALOG["entries"]
        ]
    }


@router.get("/sounds/{preset_id}/preview")
async def preview_sound(preset_id: str) -> FileResponse:
    preset = next((e for e in CATALOG["entries"] if e["id"] == preset_id), None)
    if preset is None or not preset.get("file"):
        raise NotFoundError("Audio preview not found")
    return FileResponse(ROOT / preset["file"], media_type="audio/wav")


class SoundRequest(BaseModel):
    preset_id: str
    as_instrument: bool = False


@router.post("/projects/{project_id}/sounds")
async def add_sound(project_id: str, payload: SoundRequest, session: SessionDep, storage: StorageDep) -> Source:
    await get_project(session, project_id)
    preset = next((e for e in CATALOG["entries"] if e["id"] == payload.preset_id), None)
    if preset is None:
        raise NotFoundError("Sound not found")
    source = Source(
        name=preset["name"],
        kind="drums" if preset["kind"] == "drums" else "notes",
        sound=preset.get("sound", "piano"),
        drum_kit=preset.get("drum_kit", "studio"),
    )
    if preset.get("file"):
        data = (ROOT / preset["file"]).read_bytes()
        asset = Asset(
            id=new_id(),
            project_id=project_id,
            kind="sample",
            filename=preset["file"],
            content_type="audio/wav",
            size_bytes=len(data),
            storage_key="",
        )
        asset.storage_key = f"{project_id}/{asset.id}.wav"
        await storage.save(asset.storage_key, UploadFile(file=BytesIO(data)))
        session.add(asset)
        await session.commit()
        source.asset_id = asset.id
        if payload.as_instrument or preset.get("sampler"):
            source.sampler = Sampler(rootNote=preset.get("root_note", 60), oneShot=True)
        else:
            source.kind = "audio"
            source.duration = preset["duration"]
    return source
