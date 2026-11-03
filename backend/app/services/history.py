"""Internal reversible deltas. Public producer commands cannot submit these."""

from copy import deepcopy
from typing import Literal

from pydantic import BaseModel, JsonValue
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.project import Operation, Project
from app.schemas.project import ProjectRead


class Delta(BaseModel):
    op: Literal["set", "insert", "remove", "move"]
    path: list[str]
    value: JsonValue = None
    entity_id: str | None = None
    index: int | None = None


def changes(before: dict, after: dict) -> list[dict]:
    """Diff fields and stable-ID entity lists without replacing unrelated entities."""
    result: list[Delta] = []

    def walk(old: JsonValue, new: JsonValue, path: list[str]) -> None:
        if old == new:
            return
        if isinstance(old, dict) and isinstance(new, dict) and old.keys() == new.keys():
            for key in old:
                walk(old[key], new[key], [*path, key])
        elif isinstance(old, list) and isinstance(new, list):
            # Project lists are tracks/clips, both identified by persistent IDs.
            current = [item["id"] for item in old]
            wanted = [item["id"] for item in new]
            if current == wanted:
                for old_item, new_item in zip(old, new, strict=True):
                    walk(old_item, new_item, [*path, old_item["id"]])
                return
            wanted_ids = set(wanted)
            old_by_id = {item["id"]: item for item in old}
            for entity_id in reversed(current.copy()):
                if entity_id not in wanted_ids:
                    result.append(Delta(op="remove", path=path, entity_id=entity_id))
                    current.remove(entity_id)
            for index, item in enumerate(new):
                entity_id = item["id"]
                if entity_id not in current:
                    result.append(Delta(op="insert", path=path, value=item, index=index))
                    current.insert(index, entity_id)
                else:
                    if current.index(entity_id) != index:
                        result.append(Delta(op="move", path=path, entity_id=entity_id, index=index))
                        current.remove(entity_id)
                        current.insert(index, entity_id)
                    walk(old_by_id[entity_id], item, [*path, entity_id])
        else:
            result.append(Delta(op="set", path=path, value=new))

    walk(before, after, [])
    return [item.model_dump(mode="json", exclude_none=True) for item in result]


def restore(state: dict, deltas: list[dict]) -> dict:
    state = deepcopy(state)

    def resolve(path: list[str]):
        target = state
        for segment in path:
            target = (
                next(item for item in target if item["id"] == segment) if isinstance(target, list) else target[segment]
            )
        return target

    for raw in deltas:
        delta = Delta.model_validate(raw)
        if delta.op == "set":
            resolve(delta.path[:-1])[delta.path[-1]] = deepcopy(delta.value)
        else:
            collection = resolve(delta.path)
            if delta.op == "insert":
                collection.insert(delta.index, deepcopy(delta.value))
            elif delta.op == "remove":
                collection.remove(next(item for item in collection if item["id"] == delta.entity_id))
            else:
                item = next(item for item in collection if item["id"] == delta.entity_id)
                collection.remove(item)
                collection.insert(delta.index, item)
    return state


async def undo_target(session: AsyncSession, project_id: str, version: int) -> Operation | None:
    compensation = aliased(Operation)
    return await session.scalar(
        select(Operation)
        .where(
            Operation.project_id == project_id,
            Operation.version <= version,
            Operation.baseline.is_(False),
            Operation.undo_of.is_(None),
            ~exists().where(compensation.undo_of == Operation.id, compensation.version <= version),
        )
        .order_by(Operation.version.desc())
        .limit(1)
    )


async def read_project(session: AsyncSession, project: Project) -> ProjectRead:
    data = ProjectRead.model_validate(project)
    data.can_undo = await undo_target(session, project.id, project.version) is not None
    return data
