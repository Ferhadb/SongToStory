from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    youtube_api_key: str = ""
    enable_ytdlp: bool = True
    data_dir: Path = Path("./data")
    max_upload_bytes: int = 60 * 1024 * 1024
    max_audio_seconds: int = 30 * 60
    ytdlp_timeout_s: int = 180
    # Rendering
    render_timeout_s: int = 900
    render_max_seconds: int = 300
    # URL the headless browser uses to fetch assets from this API while rendering.
    render_asset_base: str = "http://localhost:8000/api/v1/assets"
    renderer_dir: Path = Path("../apps/renderer")
    node_bin: str = "node"


def get_settings() -> Settings:
    return Settings()
