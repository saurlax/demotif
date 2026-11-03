from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DEMOTIF_",
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Demotif API"
    environment: str = "local"
    database_url: str = f"sqlite+aiosqlite:///{DATA_DIR / 'demotif.db'}"
    media_root: Path = DATA_DIR / "media"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_bytes: int = 100 * 1024 * 1024

    def prepare_directories(self) -> None:
        self.media_root.mkdir(parents=True, exist_ok=True)
        if self.database_url.startswith("sqlite"):
            DATA_DIR.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
