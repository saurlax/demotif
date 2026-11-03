"""Additive, transactional migration of snapshot history to reversible operations."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models.project import Operation, Project, Revision
from app.services.history import changes, restore


def backup_database(database_url: str) -> Path | None:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    source = Path(url.database)
    if not source.is_file():
        return None
    # Inspect read-only before deciding whether a pre-migration backup is needed.
    with sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "projects" in tables and "is_draft" not in {
            row[1] for row in connection.execute("PRAGMA table_info(projects)")
        }:
            backup = source.with_name(f"{source.name}.pre-drafts-{datetime.now(UTC):%Y%m%dT%H%M%S%f}.bak")
            with sqlite3.connect(backup) as destination:
                connection.backup(destination)
            return backup
        if "revisions" not in tables:
            return None
        if "operations" in tables:
            pending = connection.execute(
                "SELECT 1 FROM revisions r WHERE NOT EXISTS "
                "(SELECT 1 FROM operations o WHERE o.project_id=r.project_id) LIMIT 1"
            ).fetchone()
        else:
            pending = connection.execute("SELECT 1 FROM revisions LIMIT 1").fetchone()
        if not pending:
            return None
        backup = source.with_name(f"{source.name}.pre-operations-{datetime.now(UTC):%Y%m%dT%H%M%S%f}.bak")
        with sqlite3.connect(backup) as destination:
            connection.backup(destination)
    return backup


async def migrate_history(session: AsyncSession) -> None:
    projects = (await session.scalars(select(Project).order_by(Project.id))).all()
    try:
        for project in projects:
            if await session.scalar(select(Operation.id).where(Operation.project_id == project.id).limit(1)):
                continue
            revisions = (
                await session.scalars(
                    select(Revision).where(Revision.project_id == project.id).order_by(Revision.version)
                )
            ).all()
            if not revisions or [row.version for row in revisions] != list(range(1, project.version + 1)):
                raise RuntimeError(
                    f"History migration: project {project.id} has missing revisions; restore a consistent backup."
                )
            if revisions[-1].document != project.document or revisions[-1].name != project.name:
                raise RuntimeError(
                    f"History migration: project {project.id} snapshot differs from current state; repair before retrying."
                )
            previous = None
            for row in revisions:
                state = {"name": row.name, "document": row.document}
                forward = changes(previous, state) if previous is not None else []
                inverse = changes(state, previous) if previous is not None else []
                if previous is not None and (
                    restore(previous, forward) != state or restore(state, inverse) != previous
                ):
                    raise RuntimeError(f"History migration: project {project.id} failed delta validation.")
                session.add(
                    Operation(
                        project_id=project.id,
                        version=row.version,
                        summary=row.summary,
                        forward=forward,
                        inverse=inverse,
                        baseline=previous is None,
                        created_at=row.created_at,
                    )
                )
                previous = state
        await session.commit()
    except Exception:
        await session.rollback()
        raise


async def upgrade_history(engine: AsyncEngine) -> None:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        await migrate_history(session)


async def upgrade_drafts(engine: AsyncEngine) -> None:
    from sqlalchemy import inspect, text

    async with engine.begin() as connection:
        columns = await connection.run_sync(lambda conn: {c["name"] for c in inspect(conn).get_columns("projects")})
        additions = {
            "is_draft": "BOOLEAN NOT NULL DEFAULT false",
            "draft_base_id": "VARCHAR(32)",
            "draft_base_version": "INTEGER",
            "draft_example_id": "VARCHAR(100)",
            "draft_checkpoint": "JSON",
        }
        for name, declaration in additions.items():
            if name not in columns:
                await connection.execute(text(f"ALTER TABLE projects ADD COLUMN {name} {declaration}"))
