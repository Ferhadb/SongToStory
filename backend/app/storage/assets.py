"""Local-filesystem asset store. Blob names are server-generated UUIDs (no user paths)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

_ID = re.compile(r"^[0-9a-f]{32}$")


class Asset(BaseModel):
    id: str
    kind: str  # audio | image | video
    origin: str  # upload | youtube | provider_preview
    filename: str  # stored blob name
    mime: str
    size: int
    duration_ms: int | None = None
    width: int | None = None
    height: int | None = None
    codec: str | None = None
    title: str | None = None
    created_at: str


class AssetStore:
    def __init__(self, root: Path):
        self.root = root / "assets"
        self.root.mkdir(parents=True, exist_ok=True)

    def new_id(self) -> str:
        return uuid.uuid4().hex

    def blob_path(self, asset_id: str, ext: str) -> Path:
        if not _ID.match(asset_id) or not re.fullmatch(r"[a-z0-9]{2,5}", ext):
            raise ValueError("bad asset id/ext")
        return self.root / f"{asset_id}.{ext}"

    def save_meta(self, a: Asset) -> Asset:
        (self.root / f"{a.id}.json").write_text(a.model_dump_json())
        return a

    def get(self, asset_id: str) -> Asset | None:
        if not _ID.match(asset_id):
            return None
        p = self.root / f"{asset_id}.json"
        return Asset.model_validate(json.loads(p.read_text())) if p.exists() else None

    def path_of(self, a: Asset) -> Path:
        return self.root / a.filename

    @staticmethod
    def now() -> str:
        return datetime.now(UTC).isoformat()
