"""Local filesystem storage.

The only storage implementation in this milestone. It is behind a tiny interface so a Supabase
Storage or S3 implementation can replace it without touching the pipeline.

Two rules this module enforces:
  * **The original upload is preserved and never overwritten.** It is written once to
    `data/uploads/<job>/source.<ext>` and every derived asset goes somewhere else.
  * Nothing is served from outside the data directory. `resolve_public` refuses traversal.
"""

from __future__ import annotations

import hashlib
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from .config import settings

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")

#: `.` and `..` satisfy the pattern above but are directory references rather than names. They are
#: refused separately: a filename of `..` would resolve to the parent directory, so the pattern
#: alone is not enough to keep a write inside its job directory.
_RESERVED_SEGMENTS = frozenset({".", ".."})


class StorageError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredFile:
    #: Path relative to the data directory, e.g. "assets/<job>/cutout-left.png".
    rel_path: str
    absolute: Path
    size_bytes: int
    sha256: str


def _safe(segment: str) -> str:
    if segment in _RESERVED_SEGMENTS or not _SAFE_SEGMENT.match(segment):
        raise StorageError(f"unsafe path segment: {segment!r}")
    return segment


def job_dir(job_id: str, *, kind: str) -> Path:
    """`data/<kind>/<job_id>` — created on demand."""
    if kind not in {"uploads", "assets"}:
        raise StorageError(f"unknown storage kind: {kind!r}")
    root = settings.upload_dir if kind == "uploads" else settings.asset_dir
    path = root / _safe(job_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_bytes(job_id: str, *, kind: str, filename: str, data: bytes) -> StoredFile:
    """Write bytes under a job directory and return a verified handle."""
    directory = job_dir(job_id, kind=kind)
    target = directory / _safe(filename)
    target.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    written = target.stat().st_size
    if written != len(data):
        raise StorageError(f"short write for {target}: {written} != {len(data)}")
    return StoredFile(
        rel_path=f"{kind}/{job_id}/{filename}",
        absolute=target,
        size_bytes=written,
        sha256=digest,
    )


def read_bytes(rel_path: str) -> bytes:
    return resolve_public(rel_path).read_bytes()


def exists(rel_path: str) -> bool:
    try:
        return resolve_public(rel_path).is_file()
    except StorageError:
        return False


def resolve_public(rel_path: str) -> Path:
    """Resolve a client-supplied relative path, refusing anything outside the data directory.

    The API serves asset URLs that were handed out by this service, but a caller can ask for any
    path. Normalising and then checking containment is what stops `../../etc/passwd`.
    """
    if not rel_path or rel_path.startswith(("/", "\\")):
        raise StorageError("absolute paths are not permitted")
    parts = [p for p in rel_path.replace("\\", "/").split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise StorageError("parent traversal is not permitted")

    candidate = (settings.data_dir / Path(*parts)).resolve()
    root = settings.data_dir.resolve()
    if root != candidate and root not in candidate.parents:
        raise StorageError("path escapes the data directory")
    if not candidate.is_file():
        raise StorageError("no such file")
    return candidate


def public_url(rel_path: str) -> str:
    return f"{settings.public_base_url}/files/{rel_path}"


def data_dir_writable() -> bool:
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.data_dir / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def job_storage_bytes(job_id: str) -> int:
    """Total bytes this job occupies. Used to report, not to enforce."""
    total = 0
    for kind in ("uploads", "assets"):
        directory = (settings.upload_dir if kind == "uploads" else settings.asset_dir) / job_id
        if directory.is_dir():
            total += sum(f.stat().st_size for f in directory.rglob("*") if f.is_file())
    return total


def purge_job(job_id: str) -> None:
    """Delete a job's files. Used only by tests and by an explicit operator action."""
    for kind in ("uploads", "assets"):
        directory = (settings.upload_dir if kind == "uploads" else settings.asset_dir) / job_id
        if directory.is_dir():
            shutil.rmtree(directory, ignore_errors=True)
