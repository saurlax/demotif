from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidCommandError, LockedSectionError, NotFoundError, VersionConflictError
from app.models.project import Operation, Project, utcnow
from app.schemas.command import (
    AddClip,
    AddTrack,
    Command,
    CommandRequest,
    CommandResult,
    MoveClip,
    RemoveClip,
    RemoveTrack,
    RenameProject,
    SetTempo,
    SetTrackLock,
    UndoResult,
)
from app.schemas.document import Clip, ProjectDocument, Track
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
            document.tempo = tempo
            return f"Set tempo to {tempo} BPM"
        case AddTrack(name=name, kind=kind, color=color):
            document.tracks.append(Track(name=name, kind=kind, color=color))
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
    summary = _apply(document, request.command)
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
