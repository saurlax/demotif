import json
from hashlib import sha256

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidCommandError, LockedSectionError, NotFoundError, VersionConflictError
from app.models.project import Asset, CommandReceipt, Operation, Project, utcnow
from app.schemas.command import (
    AddClip,
    AddPart,
    AddSource,
    AddTrack,
    BatchRequest,
    BatchResult,
    Command,
    CommandRequest,
    CommandResult,
    MoveClip,
    RemoveClip,
    RemovePart,
    RemoveTrack,
    RenameProject,
    SetMixer,
    SetSections,
    SetTempo,
    SetTimeSignature,
    SetTrackLock,
    SplitClip,
    UndoResult,
    UpdateClip,
    UpdateSource,
    UpdateTrack,
)
from app.schemas.document import Clip, ProjectDocument, Source, Track, new_id
from app.schemas.project import ProjectRead
from app.services.history import changes, read_project, restore, undo_target


def _require_track(document: ProjectDocument, track_id: str) -> Track:
    track = document.find_track(track_id)
    if track is None:
        raise NotFoundError("Track not found in project")
    return track


def _apply(document: ProjectDocument, command: Command) -> str:
    match command:
        case RenameProject(name=name):
            return f"Rename project to “{name}”"
        case SetTempo(tempo=tempo):
            old_tempo = document.tempo
            sources = {s.id: s for s in document.sources}
            for track in document.tracks:
                for clip in track.clips:
                    source = sources.get(clip.source_id)
                    if (source and source.kind == "audio") or (not source and clip.asset_id):
                        clip.source_duration = clip.source_duration or clip.length_beats * 60 / old_tempo
                        clip.length_beats = clip.source_duration * tempo / 60
            document.tempo = tempo
            return f"Set tempo to {tempo} BPM"
        case SetTimeSignature(time_signature=time_signature):
            document.time_signature = time_signature
            return f"Set time signature to {time_signature}"
        case AddTrack(name=name, kind=kind, color=color):
            document.tracks.append(Track(id=command.id or new_id(), name=name, kind=kind, color=color))
            return f"Add {kind} track “{name}”"
        case RemoveTrack(track_id=track_id):
            track = _require_track(document, track_id)
            if track.locked:
                raise LockedSectionError(f"Track “{track.name}” is locked")
            document.tracks.remove(track)
            return f"Remove track “{track.name}”"
        case SetTrackLock(track_id=track_id, locked=locked):
            track = _require_track(document, track_id)
            track.locked = locked
            return f"{'Lock' if locked else 'Unlock'} track “{track.name}”"
        case AddClip(track_id=track_id, name=name, kind=kind, start_beat=start, length_beats=length, asset_id=asset_id):
            track = _require_track(document, track_id)
            if track.locked:
                raise LockedSectionError(f"Track “{track.name}” is locked")
            clip = Clip(
                id=command.id or new_id(),
                source_id=command.source_id,
                offset=command.offset,
                source_duration=command.source_duration,
                name=name,
                kind=kind,
                start_beat=start,
                length_beats=length,
                asset_id=asset_id,
                color=track.color,
            )
            track.clips.append(clip)
            return f"Add clip “{name}” to “{track.name}”"
        case MoveClip(track_id=track_id, clip_id=clip_id, start_beat=start):
            track = _require_track(document, track_id)
            clip = next((item for item in track.clips if item.id == clip_id), None)
            if clip is None:
                raise NotFoundError("Clip not found in track")
            if track.locked or clip.locked:
                raise LockedSectionError(f"Clip “{clip.name}” is locked")
            clip.start_beat = start
            return f"Move clip “{clip.name}” to beat {start:g}"
        case RemoveClip(track_id=track_id, clip_id=clip_id):
            track = _require_track(document, track_id)
            clip = next((item for item in track.clips if item.id == clip_id), None)
            if clip is None:
                raise NotFoundError("Clip not found in track")
            if track.locked or clip.locked:
                raise LockedSectionError(f"Clip “{clip.name}” is locked")
            track.clips.remove(clip)
            return f"Remove clip “{clip.name}”"
        case AddSource(source=source):
            document.sources.append(source.model_copy(deep=True))
            return f"Create source “{source.name}”"
        case UpdateSource(source_id=source_id):
            source = next((s for s in document.sources if s.id == source_id), None)
            if source is None:
                raise NotFoundError("Source not found")
            for track in document.tracks:
                if any(c.source_id == source_id and (track.locked or c.locked) for c in track.clips):
                    raise LockedSectionError(
                        "This source is used by a locked section. Duplicate it to edit independently."
                    )
            values = command.model_dump(exclude_unset=True, exclude={"type", "source_id"})
            replacement = Source.model_validate({**source.model_dump(), **values})
            document.sources[document.sources.index(source)] = replacement
            return f"Edit source “{source.name}”"
        case AddPart(part=part):
            document.parts.append(part.model_copy(deep=True))
            return f"Save Part “{part.name}”"
        case RemovePart(part_id=part_id):
            part = next((p for p in document.parts if p.id == part_id), None)
            if part is None:
                raise NotFoundError("Part not found")
            document.parts.remove(part)
            return f"Remove saved Part “{part.name}”"
        case UpdateTrack(track_id=track_id):
            track = _require_track(document, track_id)
            if track.locked:
                raise LockedSectionError("Track is locked")
            for key, value in command.model_dump(exclude_unset=True, exclude={"type", "track_id"}).items():
                setattr(track, key, value if key != "effects" else command.effects)
            return f"Edit track “{track.name}”"
        case UpdateClip(track_id=track_id, clip_id=clip_id) | SplitClip(track_id=track_id, clip_id=clip_id):
            track = _require_track(document, track_id)
            clip = next((c for c in track.clips if c.id == clip_id), None)
            if clip is None:
                raise NotFoundError("Clip not found")
            if track.locked or clip.locked:
                raise LockedSectionError("Clip is locked")
            if isinstance(command, SplitClip):
                delta = command.at_beat - clip.start_beat
                if not 0 < delta < clip.length_beats:
                    raise InvalidCommandError("Split must be inside the clip")
                source = next((s for s in document.sources if s.id == clip.source_id), None)
                ratio = (
                    60 / document.tempo if (source and source.kind == "audio") or (not source and clip.asset_id) else 1
                )
                window = clip.source_duration or clip.length_beats * ratio
                cut = delta * ratio
                if cut >= window:
                    raise InvalidCommandError("Split exceeds source window")
                envelope = clip.envelope_duration or window
                right = clip.model_copy(
                    update={
                        "id": new_id(),
                        "start_beat": command.at_beat,
                        "length_beats": clip.length_beats - delta,
                        "offset": clip.offset + cut,
                        "source_duration": window - cut,
                        "envelope_duration": envelope,
                        "envelope_offset": clip.envelope_offset + cut,
                    }
                )
                clip.length_beats = delta
                clip.source_duration = cut
                clip.envelope_duration = envelope
                track.clips.insert(track.clips.index(clip) + 1, right)
            else:
                values = command.model_dump(
                    exclude_unset=True, exclude={"type", "track_id", "clip_id", "target_track_id"}
                )
                for key, value in values.items():
                    setattr(clip, key, value)
                if command.target_track_id and command.target_track_id != track.id:
                    target = _require_track(document, command.target_track_id)
                    if target.locked:
                        raise LockedSectionError("Target track is locked")
                    track.clips.remove(clip)
                    target.clips.append(clip)
            return f"Edit clip “{clip.name}”"
        case SetMixer(mixer=mixer):
            if any(t.locked or any(c.locked for c in t.clips) for t in document.tracks):
                raise LockedSectionError("Mixer changes affect locked sections")
            document.mixer = mixer
            return "Edit mixer"
        case SetSections(sections=sections):
            document.sections = sections
            return "Edit sections"
        case _:
            raise InvalidCommandError(f"Unsupported command: {command}")


async def _persist(
    session: AsyncSession,
    project: Project,
    expected_version: int,
    state: dict,
    operation: Operation,
) -> ProjectRead:
    project_id = project.id
    try:
        result = await session.execute(
            update(Project)
            .where(Project.id == project_id, Project.version == expected_version)
            .values(name=state["name"], document=state["document"], version=expected_version + 1, updated_at=utcnow())
            .returning(Project.id),
            execution_options={"synchronize_session": False},
        )
        if result.scalar_one_or_none() is None:
            await session.rollback()
            current = await session.scalar(select(Project.version).where(Project.id == project_id))
            raise VersionConflictError(current)
        session.add(operation)
        await session.flush()
        await session.refresh(project)
        response = await read_project(session, project)
        await session.commit()
        return response
    except OperationalError as exc:
        await session.rollback()
        if session.bind.dialect.name == "sqlite" and "locked" in str(exc).lower():
            current = await session.scalar(select(Project.version).where(Project.id == project_id))
            raise VersionConflictError(current) from exc
        raise
    except Exception:
        await session.rollback()
        raise


async def apply_command(session: AsyncSession, project: Project, request: CommandRequest) -> CommandResult:
    if project.version != request.expected_version:
        raise VersionConflictError(project.version)
    document = ProjectDocument.model_validate(project.document)
    try:
        summary = _apply(document, request.command)
        document = ProjectDocument.model_validate(document.model_dump())
        await validate_media(session, project.id, document)
    except ValidationError as exc:
        raise InvalidCommandError(str(exc)) from exc
    before = {"name": project.name, "document": project.document}
    after = {
        "name": request.command.name if isinstance(request.command, RenameProject) else project.name,
        "document": document.model_dump(mode="json"),
    }
    operation = Operation(
        project_id=project.id,
        version=request.expected_version + 1,
        summary=summary,
        forward=changes(before, after),
        inverse=changes(after, before),
        created_at=utcnow(),
    )
    response = await _persist(session, project, request.expected_version, after, operation)
    return CommandResult(project=response, revision=operation, applied=request.command)


async def undo_last_change(session: AsyncSession, project: Project, expected_version: int) -> UndoResult:
    if project.version != expected_version:
        raise VersionConflictError(project.version)
    target = await undo_target(session, project.id, expected_version)
    if target is None:
        raise InvalidCommandError("Nothing to undo")
    after = restore({"name": project.name, "document": project.document}, target.inverse)
    after["document"] = ProjectDocument.model_validate(after["document"]).model_dump(mode="json")
    operation = Operation(
        project_id=project.id,
        version=expected_version + 1,
        summary=f"Undo change from version {target.version}",
        undo_of=target.id,
        forward=target.inverse,
        inverse=target.forward,
        created_at=utcnow(),
    )
    response = await _persist(session, project, expected_version, after, operation)
    return UndoResult(project=response, revision=operation)


async def validate_media(session: AsyncSession, project_id: str, document: ProjectDocument) -> None:
    refs = {s.asset_id for s in document.sources if s.asset_id}
    refs.update(c.asset_id for t in document.tracks for c in t.clips if c.asset_id)
    refs.update(row.asset_id for s in document.sources for row in s.drum_samples)
    if refs:
        owned = set(await session.scalars(select(Asset.id).where(Asset.project_id == project_id, Asset.id.in_(refs))))
        if refs - owned:
            raise InvalidCommandError("Media asset is missing or belongs to another project")


async def apply_batch(session: AsyncSession, project: Project, request: BatchRequest) -> BatchResult:
    fingerprint = sha256(
        json.dumps(request.model_dump(mode="json", exclude_unset=True), sort_keys=True).encode()
    ).hexdigest()
    receipt = await session.get(CommandReceipt, (project.id, request.request_id))
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise InvalidCommandError("Request ID already used for another edit")
        operation = await session.scalar(
            select(Operation).where(Operation.project_id == project.id, Operation.version == receipt.version)
        )
        return BatchResult(project=await read_project(session, project), revision=operation)
    if project.version != request.expected_version:
        raise VersionConflictError(project.version)
    document = ProjectDocument.model_validate(project.document)
    name = project.name
    summaries = []
    try:
        for command in request.commands:
            summaries.append(_apply(document, command))
            if isinstance(command, RenameProject):
                name = command.name
        document = ProjectDocument.model_validate(document.model_dump())
        await validate_media(session, project.id, document)
    except ValidationError as exc:
        raise InvalidCommandError(str(exc)) from exc
    before = {"name": project.name, "document": project.document}
    after = {"name": name, "document": document.model_dump(mode="json")}
    operation = Operation(
        project_id=project.id,
        version=project.version + 1,
        summary="; ".join(summaries)[:500],
        forward=changes(before, after),
        inverse=changes(after, before),
    )
    session.add(
        CommandReceipt(
            project_id=project.id, request_id=request.request_id, fingerprint=fingerprint, version=project.version + 1
        )
    )
    project_id = project.id
    try:
        result = await _persist(session, project, request.expected_version, after, operation)
    except IntegrityError:
        await session.rollback()
        receipt = await session.get(CommandReceipt, (project_id, request.request_id))
        if receipt is None:
            raise
        if receipt.fingerprint != fingerprint:
            raise InvalidCommandError("Request ID already used for another edit") from None
        current = await session.get(Project, project_id)
        operation = await session.scalar(
            select(Operation).where(Operation.project_id == project_id, Operation.version == receipt.version)
        )
        result = await read_project(session, current)
    return BatchResult(project=result, revision=operation)
