"""Local storage: what it writes, and what it refuses to read.

The refusal half is the half that matters. `resolve_public` is the only thing standing between a
client-supplied path and the filesystem, and a mistake there is a file-disclosure bug rather than a
wrong pixel. Every refusal is asserted here rather than assumed from reading the regex.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app import storage
from app.config import settings
from app.storage import (
    StorageError,
    data_dir_writable,
    exists,
    job_dir,
    job_storage_bytes,
    public_url,
    purge_job,
    read_bytes,
    resolve_public,
    write_bytes,
)


# ---------------------------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------------------------


def test_write_bytes_reports_a_verified_handle():
    data = b"\x89PNG\r\n\x1a\n not really a png, but the bytes are the bytes"
    stored = write_bytes("job1", kind="assets", filename="cutout-left.png", data=data)

    assert stored.size_bytes == len(data)
    assert stored.sha256 == hashlib.sha256(data).hexdigest()
    assert stored.rel_path == "assets/job1/cutout-left.png"
    assert stored.absolute.read_bytes() == data


def test_read_bytes_round_trips_what_was_written():
    write_bytes("job1", kind="uploads", filename="source.upload", data=b"original")
    assert read_bytes("uploads/job1/source.upload") == b"original"


def test_an_empty_file_is_written_and_read_back():
    """Zero bytes is a legitimate value to store; only the *upload* endpoint rejects it."""
    stored = write_bytes("job1", kind="assets", filename="empty.png", data=b"")
    assert stored.size_bytes == 0
    assert read_bytes(stored.rel_path) == b""


def test_two_jobs_do_not_share_a_directory():
    a = write_bytes("jobA", kind="assets", filename="cutout.png", data=b"a")
    b = write_bytes("jobB", kind="assets", filename="cutout.png", data=b"b")
    assert a.absolute != b.absolute
    assert read_bytes(a.rel_path) == b"a"
    assert read_bytes(b.rel_path) == b"b"


def test_write_bytes_refuses_an_unsafe_filename():
    for filename in ("../escape.png", "sub/dir.png", "sub\\dir.png", "", ".."):
        with pytest.raises(StorageError):
            write_bytes("job1", kind="assets", filename=filename, data=b"x")


def test_write_bytes_refuses_an_unsafe_job_id():
    for job_id in ("../..", "a/b", "", "job id"):
        with pytest.raises(StorageError):
            write_bytes(job_id, kind="assets", filename="cutout.png", data=b"x")


def test_write_bytes_refuses_an_unknown_kind():
    with pytest.raises(StorageError):
        write_bytes("job1", kind="secrets", filename="cutout.png", data=b"x")


def test_a_short_write_is_detected(monkeypatch):
    """A truncated write must raise, not be reported as a successful store of the full payload.

    Simulated by making the filesystem write fewer bytes than it was handed — the failure mode a
    full disk produces. The real method is captured first, since patching a `Path` method patches it
    globally and a naive replacement would call itself.
    """
    real_write_bytes = Path.write_bytes

    def write_less(self: Path, data: bytes) -> int:
        return real_write_bytes(self, data[: max(0, len(data) // 2)])

    monkeypatch.setattr(Path, "write_bytes", write_less, raising=True)
    with pytest.raises(StorageError) as excinfo:
        write_bytes("job1", kind="assets", filename="cutout.png", data=b"0123456789")
    assert "short write" in str(excinfo.value)


def test_job_dir_creates_on_demand_and_is_idempotent():
    first = job_dir("job1", kind="uploads")
    second = job_dir("job1", kind="uploads")
    assert first == second
    assert first.is_dir()


# ---------------------------------------------------------------------------------------------
# Reading — the refusal surface
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rel_path",
    [
        "/etc/passwd",
        "\\windows\\win.ini",
        "../secrets.txt",
        "assets/../../secrets.txt",
        "assets/job1/../../../secrets.txt",
        "",
        "..",
    ],
)
def test_traversal_and_absolute_paths_are_refused(rel_path):
    with pytest.raises(StorageError):
        resolve_public(rel_path)


def test_a_drive_absolute_path_is_refused():
    """`C:/…` has no leading slash, so the containment check is what must stop it."""
    with pytest.raises(StorageError):
        resolve_public("C:/Windows/win.ini")


def test_a_path_outside_the_data_directory_is_refused(data_dir):
    """Seeded just outside the root, so containment is tested against a file that really exists."""
    outside = data_dir.parent / "outside-the-root.txt"
    outside.write_text("not yours", encoding="utf-8")
    try:
        with pytest.raises(StorageError):
            resolve_public("../outside-the-root.txt")
    finally:
        outside.unlink(missing_ok=True)


def test_a_missing_file_is_refused():
    with pytest.raises(StorageError):
        resolve_public("assets/job1/not-here.png")


def test_a_directory_is_not_a_file():
    job_dir("job1", kind="assets")
    with pytest.raises(StorageError):
        resolve_public("assets/job1")


def test_a_legitimate_path_resolves_inside_the_data_directory(data_dir):
    write_bytes("job1", kind="assets", filename="cutout.png", data=b"png")
    resolved = resolve_public("assets/job1/cutout.png")
    assert resolved == (data_dir / "assets" / "job1" / "cutout.png").resolve()


@pytest.mark.parametrize("rel_path", ["assets/job1/cutout.png", "./assets/job1/cutout.png", "assets//job1/cutout.png", "assets\\job1\\cutout.png"])
def test_harmless_path_spellings_still_resolve(rel_path):
    """Normalisation must not be so strict that a legitimate URL stops working."""
    write_bytes("job1", kind="assets", filename="cutout.png", data=b"png")
    assert resolve_public(rel_path).name == "cutout.png"


def test_exists_reports_rather_than_raises():
    assert exists("assets/job1/nope.png") is False
    assert exists("../../etc/passwd") is False
    write_bytes("job1", kind="assets", filename="cutout.png", data=b"png")
    assert exists("assets/job1/cutout.png") is True


# ---------------------------------------------------------------------------------------------
# Reporting and cleanup
# ---------------------------------------------------------------------------------------------


def test_public_url_is_built_from_the_configured_base():
    assert public_url("assets/job1/cutout.png") == (
        f"{settings.public_base_url}/files/assets/job1/cutout.png"
    )


def test_job_storage_bytes_counts_both_kinds():
    # A job id used by no other test: the data directory is shared across the session.
    write_bytes("bytes-job", kind="uploads", filename="source.upload", data=b"12345")
    write_bytes("bytes-job", kind="assets", filename="cutout.png", data=b"123")
    assert job_storage_bytes("bytes-job") == 8
    assert job_storage_bytes("never-existed") == 0


def test_purge_job_removes_uploads_and_assets():
    write_bytes("purge-job", kind="uploads", filename="source.upload", data=b"x")
    write_bytes("purge-job", kind="assets", filename="cutout.png", data=b"y")
    assert job_storage_bytes("purge-job") == 2

    purge_job("purge-job")
    assert job_storage_bytes("purge-job") == 0
    assert not exists("uploads/purge-job/source.upload")
    assert not exists("assets/purge-job/cutout.png")


def test_purging_an_unknown_job_is_harmless():
    purge_job("never-existed")  # must not raise


def test_the_data_directory_is_writable_where_the_tests_run():
    """The health endpoint reports this; if it were false the whole service is useless."""
    assert data_dir_writable() is True
    # The probe must not be left behind.
    assert not (settings.data_dir / ".write-probe").exists()
