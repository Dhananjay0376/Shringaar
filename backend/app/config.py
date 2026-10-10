"""Configuration for the asset backend.

Read from the process environment only. There is no config file parser and no secret in here —
the service holds no credentials, because no remote provider is wired up yet.

Every value has a working default so the service starts with an empty environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        # A malformed override must not take the service down at import time; fall back and let
        # the caller see the default in /health.
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _data_dir() -> Path:
    raw = os.environ.get("ASSET_DATA_DIR", "data")
    p = Path(raw)
    return p if p.is_absolute() else (BACKEND_ROOT / p)


@dataclass(frozen=True)
class Settings:
    """Resolved settings. Instantiated once at import as `settings`."""

    provider: str
    data_dir: Path
    upload_dir: Path
    asset_dir: Path
    max_upload_bytes: int
    max_image_pixels: int
    output_long_edge: int
    enable_3d: bool
    mock_item_count: int
    cors_origins: tuple[str, ...]
    public_base_url: str


def load_settings() -> Settings:
    data_dir = _data_dir()
    origins = tuple(
        o.strip()
        for o in os.environ.get(
            "ASSET_CORS_ORIGINS",
            "http://localhost:5173,http://localhost:5199,http://127.0.0.1:5173,http://127.0.0.1:5199",
        ).split(",")
        if o.strip()
    )
    return Settings(
        provider=os.environ.get("ASSET_PROVIDER", "baseline").strip() or "baseline",
        data_dir=data_dir,
        upload_dir=data_dir / "uploads",
        asset_dir=data_dir / "assets",
        max_upload_bytes=_int("ASSET_MAX_UPLOAD_BYTES", 12 * 1024 * 1024),
        max_image_pixels=_int("ASSET_MAX_IMAGE_PIXELS", 50_000_000),
        output_long_edge=_int("ASSET_OUTPUT_LONG_EDGE", 1024),
        enable_3d=_bool("ASSET_ENABLE_3D", False),
        # How many blobs the mock background remover draws. It exists so the single / pair /
        # multiple branches can be driven end-to-end over HTTP, not only from a test that
        # constructs the provider by hand — the pair case is the one the review screen exists for,
        # and it was previously unreachable through the running service.
        mock_item_count=max(1, min(3, _int("ASSET_MOCK_ITEM_COUNT", 1))),
        cors_origins=origins,
        public_base_url=os.environ.get("ASSET_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
    )


settings = load_settings()

# Accepted upload types. Checked against the DECODED image, not the filename or the declared
# content type — see pipeline/stages/validate.py.
ACCEPTED_UPLOAD_MIME = ("image/png", "image/jpeg", "image/webp")
ACCEPTED_UPLOAD_SUFFIX = (".png", ".jpg", ".jpeg", ".webp")


def ensure_dirs() -> None:
    """Create the local storage tree. Safe to call repeatedly."""
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.asset_dir.mkdir(parents=True, exist_ok=True)
