"""Test session setup.

The environment is configured **before** any application module is imported, because `config.settings`
is a module-level singleton and `storage` binds to it at import time. Setting the variable afterwards
would leave the storage layer pointing at the repository instead of a temporary directory.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

# --- must precede every `app.*` import ---------------------------------------------------------
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="shringaar-asset-tests-"))
os.environ["ASSET_DATA_DIR"] = str(_TMP_ROOT / "data")
os.environ["ASSET_PROVIDER"] = "baseline"
os.environ["ASSET_ENABLE_3D"] = "false"
os.environ["ASSET_PUBLIC_BASE_URL"] = "http://testserver"
# --- application imports follow ----------------------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402

from app.config import ensure_dirs  # noqa: E402
from app.jobs import store  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas import STAGE_ORDER, JobState  # noqa: E402

#: States that mean the pipeline has stopped working on a job.
SETTLED = {
    JobState.AWAITING_REVIEW,
    JobState.APPROVED,
    JobState.REJECTED,
    JobState.FAILED,
}

#: How long a test will wait for a job to settle before failing. Generous: the first run of the
#: baseline provider pays for scipy's import and a cold numpy path.
SETTLE_TIMEOUT_S = 60.0


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return Path(os.environ["ASSET_DATA_DIR"])


@pytest.fixture(autouse=True)
def clean_state() -> Iterator[None]:
    """Each test starts with an empty job store and empty storage."""
    store.clear()
    ensure_dirs()
    yield
    store.clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def wait_for_job(job_id: str, *, timeout: float = SETTLE_TIMEOUT_S) -> JobState:
    """Block until a job settles, and fail loudly rather than looping forever.

    Reading the store directly rather than polling over HTTP keeps this off the network path; the
    HTTP status endpoint is exercised by its own test.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = store.get(job_id)
        if record.state in SETTLED:
            return record.state
        time.sleep(0.02)
    record = store.get(job_id)
    detail = record.stages.get(record.state.value)
    raise AssertionError(
        f"job {job_id} did not settle within {timeout}s; still {record.state.value}"
        + (f" ({detail.message})" if detail is not None and detail.message else "")
    )


def upload(
    client: TestClient,
    data: bytes,
    *,
    filename: str = "product.png",
    **fields: str,
):
    """POST one image to the jobs endpoint."""
    response = client.post(
        "/api/jobs",
        files={"file": (filename, data, "application/octet-stream")},
        data={k: v for k, v in fields.items() if v is not None},
    )
    return response


def run_job(client: TestClient, data: bytes, **fields: str):
    """Upload an image and wait for it to settle. Returns the final summary dict."""
    response = upload(client, data, **fields)
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    state = wait_for_job(job_id)
    summary = client.get(f"/api/jobs/{job_id}").json()
    summary["_final_state"] = state.value
    return summary


def stage_of(summary: dict, name: str) -> dict:
    for stage in summary["stages"]:
        if stage["stage"] == name:
            return stage
    raise AssertionError(f"no stage named {name!r} in {[s['stage'] for s in summary['stages']]}")


@pytest.fixture(scope="session", autouse=True)
def _cleanup_tmp() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_ROOT, ignore_errors=True)


__all__ = ["SETTLED", "STAGE_ORDER", "run_job", "stage_of", "upload", "wait_for_job"]
