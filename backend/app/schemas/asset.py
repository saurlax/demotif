from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    kind: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
