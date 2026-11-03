import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.adapters.storage.local import LocalBlobStore
from app.core.errors import InvalidCommandError, NotFoundError
from app.models.project import Asset, Project
from app.schemas.document import ProjectDocument
from app.services.examples import create_example, list_examples, read_pack


def example_pack(root: Path) -> tuple[Path, str]:
    directory = root / "test-song"
    (directory / "audio").mkdir(parents=True)
    payload = b"local sample fixture"
    digest = hashlib.sha256(payload).hexdigest()
    (directory / "audio" / "sample.wav").write_bytes(payload)
    document = ProjectDocument.model_validate(
        {
            "tempo": 132,
            "sources": [
                {"id": "audio", "name": "Voice", "kind": "audio", "duration": 8, "asset_id": digest},
                {
                    "id": "notes",
                    "name": "Lead",
                    "duration": 16,
                    "notes": [{"pitch": 60, "duration": 1}],
                    "synth": {"attack": 0.0005, "release": 0.008, "filterDrive": 6.7, "oscillators": [{"voices": 16}]},
                },
                {
                    "id": "drums",
                    "name": "Kit",
                    "kind": "drums",
                    "duration": 16,
                    "drum_samples": [{"pitch": 36, "name": "Kick", "asset_id": digest}],
                },
            ],
            "parts": [{"source_id": "notes", "duration": 16}],
            "tracks": [{"id": "voice", "clips": [{"source_id": "audio", "source_duration": 8, "length_beats": 17.6}]}],
            "mixer": {
                "master": {
                    "id": "master",
                    "name": "Master",
                    "automation": [{"parameter": "gain", "points": [{"time": 16, "value": 0.5}]}],
                }
            },
        }
    )
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "name": "Test song",
                "document": document.model_dump(mode="json"),
                "media": [{"id": digest, "filename": "sample.wav", "file": "audio/sample.wav"}],
            }
        )
    )
    return directory, digest


async def test_repeated_loading_creates_independent_projects_and_media_ids(session, tmp_path):
    root = tmp_path / "examples"
    directory, digest = example_pack(root)
    original = (directory / "manifest.json").read_bytes()
    storage = LocalBlobStore(tmp_path / "media", 100000)
    assert [item.id for item in list_examples(root)] == ["groove", "test-song"]
    first = await create_example(session, storage, root, "test-song")
    second = await create_example(session, storage, root, "test-song")
    assert first.id != second.id
    assets = list((await session.scalars(select(Asset))).all())
    assert len(assets) == 2 and assets[0].id != assets[1].id
    assert assets[0].storage_key == assets[1].storage_key
    assert hashlib.sha256(storage.path(assets[0].storage_key).read_bytes()).hexdigest() == digest
    assert first.document.sources[0].asset_id != second.document.sources[0].asset_id
    assert first.document.sources[2].drum_samples[0].asset_id == first.document.sources[0].asset_id
    assert first.document.sources[1].synth.oscillators[0].voices == 16
    assert first.document.sources[1].synth.filterDrive == 6.7
    assert first.document.mixer.master.automation[0].points[0].time == 16
    assert first.document.tracks[0].clips[0].source_duration == 8
    assert (directory / "manifest.json").read_bytes() == original
    assert not first.can_undo


async def test_corrupt_media_does_not_create_partial_project(session, tmp_path):
    directory, _ = example_pack(tmp_path)
    (directory / "audio/sample.wav").write_bytes(b"corrupt")
    with pytest.raises(InvalidCommandError, match="integrity"):
        await create_example(session, LocalBlobStore(tmp_path / "media", 100000), tmp_path, "test-song")
    assert await session.scalar(select(func.count()).select_from(Project)) == 0


def test_pack_rejects_outside_media_and_unknown_names(tmp_path):
    directory, _ = example_pack(tmp_path)
    (tmp_path / "outside.wav").write_bytes(b"outside")
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["media"][0]["file"] = "../outside.wav"
    (directory / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(InvalidCommandError):
        read_pack(tmp_path, "test-song")
    assert [item.id for item in list_examples(tmp_path)] == ["groove"]
    with pytest.raises(NotFoundError):
        read_pack(tmp_path, "../test-song")
