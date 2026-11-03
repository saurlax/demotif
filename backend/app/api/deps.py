from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.agent.base import Producer
from app.adapters.agent.fake import FakeProducer
from app.adapters.storage.local import LocalBlobStore
from app.core.config import get_settings
from app.db.session import get_session


def get_producer() -> Producer:
    return FakeProducer()


@lru_cache
def get_blob_store() -> LocalBlobStore:
    settings = get_settings()
    return LocalBlobStore(settings.media_root, settings.max_upload_bytes)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
ProducerDep = Annotated[Producer, Depends(get_producer)]
StorageDep = Annotated[LocalBlobStore, Depends(get_blob_store)]
