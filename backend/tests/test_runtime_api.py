import json
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import create_app
from app.services import audio_jobs, producer


@pytest_asyncio.fixture
async def runtime(monkeypatch):
    httpx = pytest.importorskip("httpx")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as db:
        await db.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    for module in (producer, audio_jobs):
        monkeypatch.setattr(module, "SessionLocal", maker)
    import app.db.session as sessions

    monkeypatch.setattr(sessions, "SessionLocal", maker)
    app = create_app()

    async def get_db():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_session] = get_db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, maker
    await producer.shutdown()
    await audio_jobs.shutdown()
    await engine.dispose()


async def test_persistent_proposal_apply_reconnect_and_restart(runtime, monkeypatch):
    from app.api.routes import producer as routes

    client, _maker = runtime

    async def model(prompt, document, previous, emit, **kwargs):
        await emit({"type": "text", "delta": "Proposed tempo."})
        return [{"type": "project.set_tempo", "tempo": 90}], {"checkpoint": "saved"}

    monkeypatch.setattr(routes, "ready", lambda: True)
    monkeypatch.setattr(producer, "produce", model)
    p = (await client.post("/api/projects", json={"name": "Song"})).json()
    id = p["id"]
    run_id = str(uuid4())
    base = f"/api/projects/{id}/producer"
    response = await client.post(base + "/runs", json={"id": run_id, "text": "Change tempo", "expected_version": 1})
    assert response.status_code == 202
    task = producer._tasks.get(run_id)
    if task:
        await task
    history = (await client.get(base)).json()
    assert history["runs"][0]["status"] == "complete"
    assert history["runs"][0]["events"][0]["delta"] == "Proposed tempo."
    assert (await client.get(f"/api/projects/{id}")).json()["document"]["tempo"] == 120
    applied = await client.post(base + f"/runs/{run_id}/apply")
    assert applied.status_code == 200 and applied.json()["project"]["document"]["tempo"] == 90
    again = await client.post(base + f"/runs/{run_id}/apply")
    assert again.status_code == 200 and again.json()["project"]["version"] == 2
    response = await client.get(base + f"/runs/{run_id}/events?after=1")
    assert response.status_code == 200 and "event: done" in response.text
    undone = await client.post(f"/api/projects/{id}/undo", json={"expected_version": 2})
    assert undone.json()["project"]["document"]["tempo"] == 120


async def test_stale_proposal_and_project_isolation(runtime, monkeypatch):
    from app.models.project import ProducerRun

    client, maker = runtime
    p = (await client.post("/api/projects", json={"name": "Song"})).json()
    id = p["id"]
    async with maker() as db:
        db.add(
            ProducerRun(
                id="proposal",
                project_id=id,
                base_version=1,
                prompt="tempo",
                status="complete",
                commands=[{"type": "project.set_tempo", "tempo": 80}],
            )
        )
        await db.commit()
    await client.post(
        f"/api/projects/{id}/commands",
        json={"expected_version": 1, "command": {"type": "project.set_tempo", "tempo": 100}},
    )
    response = await client.post(f"/api/projects/{id}/producer/runs/proposal/apply")
    assert response.status_code == 409
    assert (await client.post("/api/projects/other/producer/runs/proposal/apply")).status_code == 404
    assert (await client.get(f"/api/projects/{id}")).json()["document"]["tempo"] == 100


async def test_copy_import_and_example_keep_independent_documents(runtime):
    client, _ = runtime
    example = await client.post("/api/projects/examples/groove")
    assert example.status_code == 201
    p = example.json()
    assert len(p["document"]["tracks"]) == 3
    copied = (await client.post(f"/api/projects/{p['id']}/copy")).json()
    assert copied["id"] != p["id"] and copied["document"] == p["document"]
    imported = (await client.post("/api/projects/import", json={"name": "Imported", "document": p["document"]})).json()
    assert imported["id"] != p["id"] and imported["document"] == p["document"]


async def test_audio_job_idempotency_and_existing_task_resume(runtime, monkeypatch, tmp_path):
    import wave

    from app.adapters.audio import provider
    from app.api.routes import audio_jobs as routes
    from app.core.config import get_settings

    client, _maker = runtime
    monkeypatch.setattr(routes, "available", lambda: True)
    monkeypatch.setattr(get_settings(), "media_root", tmp_path)
    submits = []

    async def submit(ability, payload):
        submits.append(ability)
        return {"task_id": "paid-task"}

    async def poll(task_id):
        return {
            "status": "succeed",
            "task_id": task_id,
            "resp_payload": json.dumps({"resources": [{"url": "https://example.com/result.wav"}]}),
        }

    def download(url, path):
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            wav.writeframes(b"\0\0" * 2 * 44100)

    monkeypatch.setattr(provider, "submit", submit)
    monkeypatch.setattr(provider, "poll", poll)
    monkeypatch.setattr(provider, "download", download)
    p = (await client.post("/api/projects", json={"name": "Audio"})).json()
    base = f"/api/projects/{p['id']}/audio-jobs"
    payload = {"mode": "music", "prompt": "Piano", "duration_seconds": 10}
    response = await client.post(base, json=payload)
    assert response.status_code == 202
    id = response.json()["id"]
    task = audio_jobs._tasks.get(id)
    if task:
        await task
    jobs = (await client.get(base)).json()
    assert jobs[0]["status"] == "complete" and jobs[0]["results"][0]["source"]["duration"] == 1
    assert (await client.post(base, json=payload)).json()["id"] == id
    assert len(submits) == 1
    assert (await client.get(f"/api/projects/{p['id']}")).json()["document"]["sources"] == []


async def test_factory_kit_preserves_selected_sound(runtime):
    client, _ = runtime
    p = (await client.post("/api/projects", json={"name": "Kit"})).json()
    r = await client.post(f"/api/projects/{p['id']}/sounds", json={"preset_id": "kit-808"})
    assert r.status_code == 200
    assert r.json()["kind"] == "drums" and r.json()["drum_kit"] == "808"


async def test_library_preview_needs_no_project_and_does_not_create_one(runtime):
    client, _ = runtime
    before = (await client.get("/api/projects")).json()
    catalog = await client.get("/api/sounds")
    assert catalog.status_code == 200
    entries = catalog.json()["entries"]
    sample = next(e for e in entries if e["id"] == "upright-piano")
    assert "file" not in sample
    audio = await client.get(sample["preview_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    assert audio.content[:4] == b"RIFF"
    assert audio.content[8:12] == b"WAVE"
    assert (await client.get("/api/sounds/piano/preview")).status_code == 404
    assert (await client.get("/api/sounds/unknown/preview")).status_code == 404
    assert (await client.get("/api/projects")).json() == before


async def test_import_rebinds_media_to_the_new_project(runtime):
    from app.models.project import Asset

    client, maker = runtime
    original = (await client.post("/api/projects", json={"name": "Original"})).json()
    async with maker() as db:
        db.add(
            Asset(
                id="media",
                project_id=original["id"],
                kind="sample",
                filename="sample.wav",
                content_type="audio/wav",
                size_bytes=100,
                storage_key="original/sample.wav",
            )
        )
        await db.commit()
    document = original["document"]
    document["sources"] = [
        {"id": "recording", "name": "Recording", "kind": "audio", "duration": 1, "asset_id": "media"}
    ]
    response = await client.post("/api/projects/import", json={"name": "Imported audio", "document": document})
    assert response.status_code == 201
    imported = response.json()
    media_id = imported["document"]["sources"][0]["asset_id"]
    assert media_id != "media"
    async with maker() as db:
        asset = await db.get(Asset, media_id)
        assert asset.project_id == imported["id"] and asset.storage_key == "original/sample.wav"


async def test_parallel_tool_events_have_unique_ordered_cursors(runtime):
    import asyncio

    from sqlalchemy import select

    from app.models.project import ProducerEvent, ProducerRun

    client, maker = runtime
    p = (await client.post("/api/projects", json={"name": "Events"})).json()
    async with maker() as db:
        db.add(ProducerRun(id="parallel", project_id=p["id"], base_version=1, prompt="Test", status="complete"))
        await db.commit()
    await asyncio.gather(*(producer.append("parallel", {"type": "tool", "count": i}) for i in range(20)))
    async with maker() as db:
        events = (
            await db.scalars(
                select(ProducerEvent).where(ProducerEvent.run_id == "parallel").order_by(ProducerEvent.seq)
            )
        ).all()
        assert [e.seq for e in events] == list(range(1, 21))
        assert sorted(e.payload["count"] for e in events) == list(range(20))
