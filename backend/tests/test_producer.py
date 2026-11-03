import pytest

from app.adapters.agent.harness import produce
from app.schemas.document import ProjectDocument


@pytest.mark.parametrize("protocol", ["chat", "responses"])
async def test_configured_model_protocol_without_network(monkeypatch, protocol):
    pytest.importorskip("a13n_harness")
    import pydantic_ai.models.openai as models
    from pydantic_ai.models.test import TestModel

    from app.adapters.agent import harness
    from app.core.config import get_settings

    settings = get_settings().model_copy(update={
        "producer_api": protocol, "producer_model": "test-only", "producer_api_key": "test-only",
        "producer_base_url": "https://example.invalid/v1", "producer_model_settings": {},
    })
    monkeypatch.setattr(harness, "get_settings", lambda: settings)
    monkeypatch.setattr(harness, "ready", lambda: True)
    selected = []

    def model_for(api):
        def build(*args, **kwargs):
            selected.append(api)
            return TestModel(call_tools=[])
        return build

    monkeypatch.setattr(models, "OpenAIChatModel", model_for("chat"))
    monkeypatch.setattr(models, "OpenAIResponsesModel", model_for("responses"))

    async def emit(event):
        pass

    commands, _ = await produce("Connectivity check only.", ProjectDocument(), None, emit)
    assert selected == [protocol]
    assert commands == []


async def test_real_harness_contract_without_network():
    pytest.importorskip("a13n_harness")
    from pydantic_ai.models.test import TestModel

    events = []

    async def emit(payload):
        events.append(payload)

    commands, state = await produce(
        "Say hello, do not edit.", ProjectDocument(), None, emit, model=TestModel(call_tools=[])
    )
    assert not commands and state
    assert any(e["type"] == "reply" for e in events)
    assert all(e["type"] in ("text", "reply", "tool") for e in events)


async def test_proposals_are_staged_and_do_not_mutate_input():
    pytest.importorskip("a13n_harness")
    from pydantic_ai.models.function import DeltaToolCall, FunctionModel

    calls = 0

    async def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield {
                0: DeltaToolCall(
                    name="propose_edits",
                    json_args='{"edits":[{"type":"project.set_tempo","tempo":90.5}]}',
                    tool_call_id="change",
                )
            }
            return
        yield "Proposed 90.5 BPM for review."

    document = ProjectDocument()
    events = []

    async def emit(payload):
        events.append(payload)

    commands, state = await produce(
        "Set tempo to 90.5", document, None, emit, model=FunctionModel(stream_function=respond)
    )
    assert document.tempo == 120
    assert commands == [{"type": "project.set_tempo", "tempo": 90.5}]
    assert state and any(e.get("status") == "proposed" for e in events)


async def test_generated_entity_ids_survive_proposal_replay():
    pytest.importorskip("a13n_harness")
    import json

    from pydantic import TypeAdapter
    from pydantic_ai.models.function import DeltaToolCall, FunctionModel

    from app.schemas.command import Command
    from app.services.command import _apply

    calls = 0

    async def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            edits = [
                {"type": "track.add", "name": "Keys"},
                {"type": "source.add", "source": {"name": "Keys", "notes": [{"pitch": 60, "duration": 1}]}},
            ]
        elif calls == 2:
            result = next(p.content for p in messages[-1].parts if hasattr(p, "tool_name"))
            if isinstance(result, str):
                result = json.loads(result)
            d = result["project"]
            edits = [
                {
                    "type": "clip.add",
                    "track_id": d["tracks"][0]["id"],
                    "source_id": d["sources"][0]["id"],
                    "length_beats": 4,
                }
            ]
        else:
            yield "Ready for review."
            return
        yield {
            0: DeltaToolCall(name="propose_edits", json_args=json.dumps({"edits": edits}), tool_call_id=f"edit{calls}")
        }

    async def emit(event):
        pass

    commands, _ = await produce(
        "Create a short piano part.", ProjectDocument(), None, emit, model=FunctionModel(stream_function=respond)
    )
    replay = ProjectDocument()
    for raw in commands:
        _apply(replay, TypeAdapter(Command).validate_python(raw))
    accepted = ProjectDocument.model_validate(replay.model_dump())
    assert accepted.tracks[0].clips[0].source_id == accepted.sources[0].id
    assert accepted.sources[0].notes[0].id
