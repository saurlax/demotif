from pathlib import Path

from fastapi import UploadFile

from app.core.errors import ApiError

CHUNK_SIZE = 1024 * 1024


class LocalBlobStore:
    def __init__(self, root: Path, max_bytes: int) -> None:
        self.root = root.resolve()
        self.max_bytes = max_bytes

    def path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):
            raise ApiError(400, "invalid_key", "Invalid storage key")
        return target

    async def save(self, key: str, upload: UploadFile) -> int:
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        try:
            with target.open("wb") as handle:
                while chunk := await upload.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise ApiError(413, "file_too_large", "Upload exceeds the size limit")
                    handle.write(chunk)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return size

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)
