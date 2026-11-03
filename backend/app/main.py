from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import assets, audio_jobs, commands, health, messages, producer, projects, sounds
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.base import Base
from app.db.migrations import backup_database, upgrade_drafts, upgrade_history
from app.db.session import engine


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.prepare_directories()
    backup_database(settings.database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await upgrade_drafts(engine)
    await upgrade_history(engine)
    from app.services import producer as runtime

    await runtime.recover()
    from sqlalchemy import update

    from app.db.session import SessionLocal
    from app.models.project import AudioJob
    from app.services import audio_jobs as audio_runtime

    async with SessionLocal() as db:
        await db.execute(
            update(AudioJob).where(AudioJob.status.in_(["processing", "submitting"])).values(status="interrupted")
        )
        await db.commit()
    yield
    await runtime.shutdown()
    await audio_runtime.shutdown()
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.code, "message": exc.message, **exc.payload},
        )

    for router in (
        health.router,
        projects.router,
        commands.router,
        messages.router,
        assets.router,
        producer.router,
        sounds.router,
        audio_jobs.router,
    ):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
