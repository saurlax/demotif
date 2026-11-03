"""A bounded producer with only typed project tools; never host tools."""

import json
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from pydantic import Field, ValidationError

from app.core.config import get_settings
from app.core.errors import ApiError
from app.schemas.command import Command
from app.schemas.document import ProjectDocument
from app.services.command import _apply


def ready() -> bool:
    settings = get_settings()
    if not settings.producer_model or not settings.producer_api_key:
        return False
    try:
        import a13n_harness  # noqa: F401

        return True
    except ImportError:
        return False


async def produce(
    prompt: str,
    document: ProjectDocument,
    previous: dict | None,
    emit: Callable[[dict], Awaitable[None]],
    model: Any = None,
    project_id: str | None = None,
) -> tuple[list[dict], dict | None]:
    from a13n_harness import AgentSpec, HarnessBuilder, HarnessEvent, HarnessRunResultEvent, HarnessState
    from pydantic_ai import ModelRetry
    from pydantic_ai.capabilities import Capability
    from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta
    from pydantic_ai.usage import UsageLimits

    settings = get_settings()
    if model is None:
        if not ready():
            raise ApiError(503, "producer_unavailable", "Configure a model and install the producer extra.")
        from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
        from pydantic_ai.providers.openai import OpenAIProvider

        model_class = OpenAIChatModel if settings.producer_api == "chat" else OpenAIResponsesModel
        model = model_class(
            settings.producer_model,
            provider=OpenAIProvider(api_key=settings.producer_api_key, base_url=settings.producer_base_url or None),
        )
    staged = document.model_copy(deep=True)
    commands: list[dict] = []

    async def inspect_project() -> dict:
        """Read the current project. Musical time is in quarter-note beats; audio sources use seconds."""
        return staged.model_dump(mode="json")

    async def propose_edits(edits: Annotated[list[Command], Field(min_length=1, max_length=4)]) -> dict:
        """Stage 1–4 typed edits atomically for user review. Creates do not place sources automatically.
        Give created tracks/sources stable IDs and use them in later commands. No edits are applied until user approval.
        """
        nonlocal staged
        candidate = staged.model_copy(deep=True)
        if len(commands) + len(edits) > 512:
            raise ModelRetry("Proposal is too large")
        try:
            from app.schemas.command import AddClip, AddTrack
            from app.schemas.document import new_id

            for edit in edits:
                if isinstance(edit, (AddTrack, AddClip)) and not edit.id:
                    edit.id = new_id()
                _apply(candidate, edit)
            candidate = ProjectDocument.model_validate(candidate.model_dump())
        except (ValidationError, ApiError) as exc:
            await emit({"type": "tool", "name": "propose_edits", "status": "rejected"})
            raise ModelRetry(str(exc)) from exc
        staged = candidate
        for edit in edits:
            payload = edit.model_dump(mode="json", exclude_unset=True)
            if edit.type == "source.add":
                payload["source"] = edit.source.model_dump(mode="json")
            if edit.type == "part.add":
                payload["part"] = edit.part.model_dump(mode="json")
            commands.append(payload)
        await emit({"type": "tool", "name": "propose_edits", "count": len(edits), "status": "proposed"})
        return {"status": "staged_for_review", "project": staged.model_dump(mode="json")}

    import asyncio

    from app.adapters.audio.provider import AudioRequest, available
    from app.db.session import SessionLocal
    from app.models.project import AudioJob
    from app.services.audio_jobs import analysis_ready, ensure_job

    audio_calls = 0

    async def process_audio(request: AudioRequest) -> dict:
        """Generate music/speech/sound, separate generated vocals, or analyze <=30s monophonic/percussion audio.
        Only use when the user asks for real audio or analysis. Same arguments/take reuse a task; never change take to retry a failure.
        Results are saved locally and proposed as library clips for user approval. Original recordings remain unchanged.
        """
        nonlocal audio_calls
        if project_id is None or not (analysis_ready() if request.mode == "transcribe" else available()):
            raise ModelRetry("This audio capability is unavailable")
        audio_calls += 1
        if audio_calls > 3:
            raise ModelRetry("At most three audio calls per run")
        await emit({"type": "tool", "name": "process_audio", "status": "processing"})
        job = await ensure_job(project_id, request)
        for _ in range(600):
            async with SessionLocal() as db:
                job = await db.get(AudioJob, job.id)
                if job.status == "complete":
                    break
                if job.status in ("failed", "interrupted"):
                    raise ModelRetry(job.error or "Task interrupted; do not resubmit")
            await asyncio.sleep(1)
        else:
            raise ModelRetry("Audio task timed out; do not resubmit")
        from app.schemas.command import AddPart, AddSource
        from app.schemas.document import Note, Part, Source, new_id

        ids = []
        for result in job.results:
            if result.get("source"):
                source = Source.model_validate(result["source"])
            else:
                a = result["analysis"]
                beat = 60 / staged.tempo
                source = Source(
                    name=result["name"],
                    kind="notes",
                    duration=a["duration"] / beat,
                    notes=[
                        Note(
                            id=new_id(),
                            pitch=n["pitch"],
                            start=n["start"] / beat,
                            duration=n["duration"] / beat,
                            velocity=n["velocity"],
                        )
                        for n in a["notes"]
                    ],
                )
            edits = []
            if not any(s.id == source.id for s in staged.sources):
                edits.append(AddSource(source=source))
            edits.append(AddPart(part=Part(source_id=source.id, name=source.name, duration=source.duration)))
            await propose_edits(edits)
            ids.append(
                {
                    "source_id": source.id,
                    "duration": source.duration,
                    "kind": source.kind,
                    "review_required": bool(result.get("analysis")),
                }
            )
        return {"results": ids, "status": "proposed_for_review"}

    async def list_sounds() -> dict:
        """List the installed sound and drum kit IDs usable by sources. No network or paid generation."""
        from app.schemas.document import SOUNDS

        return {"sounds": list(SOUNDS), "drum_kits": ["studio", "808", "909", "lofi"]}

    tools = [inspect_project, list_sounds, propose_edits]
    if project_id and (available() or analysis_ready()):
        tools.append(process_audio)
    agent = HarnessBuilder().build(
        AgentSpec(
            instructions="""You are Demotif's music producer. Respond in the user's language. Read the project before proposing edits.
Only propose typed reversible project edits. All musical locations and note lengths are quarter-note beats; recorded audio source windows are seconds.
Sources are shared; editing them affects all placements. Respect locked tracks/clips. Use explicit notes, never invent existing media IDs.
Create stable IDs for tracks, sources and notes. Create sources and then place clips; a saved Part alone is not audible.
Use the installed synth sounds. Audio generation is unavailable unless a tool explicitly supports it. Transcribed notes require review; place them on a muted new track and preserve the original audio.
Work in batches of at most four edits. Say precisely what is proposed, not that it has already been applied.
Do not expose internal reasoning. Do not promise microphone recording, external plugins or unavailable providers.""",
            usage_limits=UsageLimits(request_limit=24, tool_calls_limit=40),
            model_settings=settings.producer_model_settings,
            retries={"tools": 4, "output": 1},
        ),
        model=model,
        output_type=str,
        capabilities=(Capability(id="demotif-producer", tools=tools),),
    )
    state = HarnessState.model_validate(previous) if previous else None
    output_state = None
    async with agent.stream(
        "Project data:\n" + json.dumps(document.model_dump(mode="json")) + "\nUser:\n" + prompt, previous_state=state
    ) as stream:
        async for item in stream:
            if isinstance(item, HarnessRunResultEvent):
                item.result.raise_for_status()
                output_state = item.result.state.model_dump(mode="json")
                await emit({"type": "reply", "text": item.result.output_or_raise()})
            elif isinstance(item, HarnessEvent):
                event = item.event
                if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                    await emit({"type": "text", "delta": event.part.content})
                elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                    await emit({"type": "text", "delta": event.delta.content_delta})
    return commands, output_state


class HarnessProducer:
    async def respond(self, text: str, document: ProjectDocument):
        from pydantic import TypeAdapter

        from app.adapters.agent.base import ProducerReply

        if not ready():
            raise ApiError(503, "producer_unavailable", "Configure the producer model and install the producer extra.")
        reply = ""

        async def collect(event: dict) -> None:
            nonlocal reply
            if event["type"] == "reply":
                reply = event["text"]

        commands, _ = await produce(text, document, None, collect)
        return ProducerReply(message=reply, commands=[TypeAdapter(Command).validate_python(c) for c in commands])
