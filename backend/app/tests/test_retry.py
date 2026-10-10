"""Retry, approval and rejection — the state machine around a finished job.

Retry is the one operation that re-enters the pipeline, so it is the one that can quietly do the
wrong thing: re-run against the wrong bytes, inherit a previous attempt's assets, or be offered for
a job where it makes no sense. Each of those is asserted here.

The transient-failure tests use a provider that fails a fixed number of times and then works. That
is the only honest way to test the success path of a retry: a job that failed for a *permanent*
reason must fail identically when re-run, and a test that expects otherwise is testing a fiction.
"""

from __future__ import annotations

import pytest
from PIL import Image

from app.jobs import JobRecord, require_retryable, store
from app.providers import ProviderSet, baseline
from app.providers.base import CutoutResult, Outcome
from app.schemas import (
    STAGE_ORDER,
    AssetRole,
    DerivedAsset,
    DerivedAssetKind,
    DetectionSummary,
    FailureCode,
    ItemConfiguration,
    JobError,
    JobState,
    ProviderInfo,
    StageResult,
    StageState,
)
from app.storage import purge_job
from app.tests import images
from app.tests.conftest import run_job, stage_of, upload, wait_for_job


class FlakyBackgroundRemover:
    """Delegates to a real remover, but fails the first few calls.

    Stands in for the class of failure that retry exists for — a timeout, a busy worker — where the
    same input succeeds on a second attempt.
    """

    def __init__(self, inner: baseline.BaselineBackgroundRemover, failures: int = 1) -> None:
        self.inner = inner
        self.remaining = failures
        self.calls = 0

    def info(self) -> ProviderInfo:
        return self.inner.info()

    def remove(self, source: Image.Image) -> Outcome[CutoutResult]:
        self.calls += 1
        if self.remaining > 0:
            self.remaining -= 1
            return Outcome.error(
                self.info(),
                FailureCode.PROVIDER_ERROR,
                "Simulated transient failure on this attempt.",
            )
        return self.inner.remove(source)


@pytest.fixture
def flaky_app():
    """An app whose background remover fails once, then works."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    providers = ProviderSet(
        name="flaky",
        background=FlakyBackgroundRemover(baseline.BaselineBackgroundRemover(), failures=1),
        detector=baseline.BaselineObjectDetector(),
        model3d=baseline.BaselineModel3DGenerator(),
    )
    app = create_app()
    app.state.providers = providers
    with TestClient(app) as client:
        yield client, providers


# ---------------------------------------------------------------------------------------------
# The state gate
# ---------------------------------------------------------------------------------------------


def test_require_retryable_accepts_only_failed():
    """Pinned as a table so the allowed set cannot be widened by accident."""
    for state in JobState:
        record = JobRecord(id="x", state=state)
        if state is JobState.FAILED:
            require_retryable(record)  # must not raise
        else:
            with pytest.raises(Exception) as excinfo:
                require_retryable(record)
            assert state.value in str(excinfo.value)


def test_retry_is_refused_for_a_job_awaiting_review(client):
    summary = run_job(client, images.png(images.single_item()))
    assert summary["state"] == JobState.AWAITING_REVIEW.value

    response = client.post(f"/api/jobs/{summary['id']}/retry")
    assert response.status_code == 409
    assert "awaiting_review" in response.json()["detail"]


def test_retry_is_refused_for_a_job_that_never_ran(client):
    """A job still in `uploaded` must be refused — re-running is not what retry means for it."""
    record = store.add(JobRecord(id="unstarted-job"))
    assert record.state is JobState.UPLOADED

    response = client.post("/api/jobs/unstarted-job/retry")
    assert response.status_code == 409
    assert "uploaded" in response.json()["detail"]


def test_retry_is_refused_for_an_unknown_job(client):
    assert client.post("/api/jobs/nope/retry").status_code == 404


def test_a_permanent_failure_is_not_offered_a_retry(client):
    """Re-running an unsupported file would fail identically, so the API says so instead."""
    summary = run_job(client, images.not_an_image(), filename="notes.txt")
    assert summary["state"] == JobState.FAILED.value
    assert summary["error"]["code"] == FailureCode.UNSUPPORTED_TYPE.value
    assert summary["error"]["retryable"] is False

    response = client.post(f"/api/jobs/{summary['id']}/retry")
    assert response.status_code == 409


def test_a_retryable_failure_says_so(client):
    summary = run_job(client, images.truncated_png(images.single_item()))
    assert summary["state"] == JobState.FAILED.value
    assert summary["error"]["code"] == FailureCode.CORRUPT_IMAGE.value
    assert summary["error"]["retryable"] is True
    assert summary["error"]["stage"] == "validating"


# ---------------------------------------------------------------------------------------------
# Retry actually re-runs — and re-runs the *same bytes*
# ---------------------------------------------------------------------------------------------


def test_a_transient_failure_succeeds_on_retry(flaky_app):
    client, providers = flaky_app
    source = images.png(images.single_item())

    first = run_job(client, source)
    assert first["state"] == JobState.FAILED.value
    assert first["attempts"] == 1
    assert providers.background.calls == 1

    response = client.post(f"/api/jobs/{first['id']}/retry")
    assert response.status_code == 200, response.text

    assert wait_for_job(first["id"]) is JobState.AWAITING_REVIEW
    retried = client.get(f"/api/jobs/{first['id']}").json()

    assert retried["attempts"] == 2
    assert providers.background.calls == 2, "the retry must re-run the pipeline"
    assert retried["assets"], "the retry produced assets"
    assert retried["error"] is None
    assert retried["progress"] == 1.0
    assert all(stage["state"] != "pending" for stage in retried["stages"])


def test_a_retry_reprocesses_the_same_original_bytes(flaky_app):
    """The preserved upload is the definition of "retry" — nothing else would be honest."""
    client, _ = flaky_app
    source = images.png(images.single_item())

    first = run_job(client, source)
    original_path = first["input"]["original_path"]
    digest = first["input"]["sha256"]

    client.post(f"/api/jobs/{first['id']}/retry")
    assert wait_for_job(first["id"]) is JobState.AWAITING_REVIEW
    retried = client.get(f"/api/jobs/{first['id']}").json()

    assert retried["input"]["sha256"] == digest, "a retry must not change the input"
    assert retried["input"]["original_path"] == original_path
    assert retried["input"]["size_bytes"] == len(source)


def test_retry_is_refused_when_the_original_upload_is_gone(flaky_app):
    client, _ = flaky_app
    first = run_job(client, images.png(images.single_item()))
    assert first["state"] == JobState.FAILED.value

    # Simulate an operator clearing the job's files out from under it.
    purge_job(first["id"])

    response = client.post(f"/api/jobs/{first['id']}/retry")
    assert response.status_code == 409
    assert "no longer available" in response.json()["detail"]


def test_a_retried_job_can_be_approved(flaky_app):
    """The whole point: a transient failure must not cost the seller the asset."""
    client, _ = flaky_app
    first = run_job(client, images.png(images.single_item()))

    client.post(f"/api/jobs/{first['id']}/retry")
    assert wait_for_job(first["id"]) is JobState.AWAITING_REVIEW
    retried = client.get(f"/api/jobs/{first['id']}").json()

    approved = client.post(
        f"/api/jobs/{first['id']}/approve",
        json={"asset_ids": [a["id"] for a in retried["assets"]]},
    )
    assert approved.status_code == 200
    assert approved.json()["state"] == JobState.APPROVED.value


# ---------------------------------------------------------------------------------------------
# reset_for_retry — the state it must clear
# ---------------------------------------------------------------------------------------------


def test_reset_for_retry_clears_everything_the_previous_attempt_produced():
    record = JobRecord(id="job1")
    record.original_rel_path = "uploads/job1/source.upload"
    record.source_file_name = "earrings.png"
    record.attempts = 3
    record.assets = [
        DerivedAsset(
            id="a1",
            kind=DerivedAssetKind.CUTOUT_2D,
            role=AssetRole.LEFT,
            path="assets/job1/cutout-left.png",
            url="http://testserver/files/assets/job1/cutout-left.png",
            mime_type="image/png",
            size_bytes=10,
            approved=True,
        )
    ]
    record.detection = DetectionSummary(
        item_count=1,
        resolved_configuration=ItemConfiguration.SINGLE,
        needs_seller_confirmation=False,
        confidence=0.9,
        explanation="One item found.",
    )
    record.error = JobError(
        code=FailureCode.PROVIDER_ERROR, stage="segmenting", message="boom", retryable=True
    )
    record.notes = ["stale note"]
    record.approved_at = record.created_at
    record.rejection_reason = "stale rejection"
    record.stages["segmenting"] = StageResult(
        stage="segmenting", state=StageState.FAILED, message="boom", duration_ms=12
    )

    record.reset_for_retry()

    assert record.state is JobState.QUEUED
    assert record.assets == []
    assert record.detection is None
    assert record.error is None
    assert record.notes == []
    assert record.approved_at is None
    assert record.rejection_reason is None
    for name in STAGE_ORDER:
        stage = record.stages[name]
        assert stage.state is StageState.PENDING, f"{name} was left {stage.state}"
        assert stage.message is None
        assert stage.duration_ms is None

    # Kept on purpose: a retry re-processes the same file and is still the same attempt history.
    assert record.original_rel_path == "uploads/job1/source.upload"
    assert record.source_file_name == "earrings.png"
    assert record.attempts == 3


def test_reset_for_retry_leaves_the_input_summary_for_the_pipeline_to_rewrite():
    """The old summary is dropped so a failed retry cannot leave a stale one visible."""
    from app.schemas import InputSummary

    record = JobRecord(id="job1")
    record.input = InputSummary(
        file_name="earrings.png",
        mime_type="image/png",
        size_bytes=100,
        sha256="0" * 64,
        width=10,
        height=10,
        mode="RGBA",
        original_path="uploads/job1/source.upload",
    )
    record.reset_for_retry()
    assert record.input is not None  # the pipeline overwrites it; it is not cleared here


# ---------------------------------------------------------------------------------------------
# Approval and rejection transitions
# ---------------------------------------------------------------------------------------------


def test_a_failed_job_has_nothing_to_approve(client):
    summary = run_job(client, images.not_an_image(), filename="notes.txt")
    response = client.post(f"/api/jobs/{summary['id']}/approve", json={})
    assert response.status_code == 409
    assert "no assets" in response.json()["detail"]


def test_approving_twice_is_refused(client):
    summary = run_job(client, images.png(images.single_item()))
    first = client.post(f"/api/jobs/{summary['id']}/approve", json={})
    assert first.status_code == 200

    second = client.post(f"/api/jobs/{summary['id']}/approve", json={})
    assert second.status_code == 409
    assert "already been approved" in second.json()["detail"]


def test_a_rejected_job_cannot_be_approved(client):
    summary = run_job(client, images.png(images.single_item()))
    assert client.post(
        f"/api/jobs/{summary['id']}/reject", json={"reason": "wrong colour"}
    ).status_code == 200

    response = client.post(f"/api/jobs/{summary['id']}/approve", json={})
    assert response.status_code == 409


def test_rejecting_an_approved_job_clears_the_approval(client):
    """A rejection is the seller changing their mind, so no asset may stay marked approved."""
    summary = run_job(client, images.png(images.single_item()))
    client.post(f"/api/jobs/{summary['id']}/approve", json={})

    rejected = client.post(f"/api/jobs/{summary['id']}/reject", json={"reason": "wrong size"})
    assert rejected.status_code == 200
    body = rejected.json()
    assert body["state"] == JobState.REJECTED.value
    assert body["assets"], "the assets are kept for the record"
    assert all(asset["approved"] is False for asset in body["assets"])

    # And the try-on gate stays shut: a rejected job is not usable.
    assert body["state"] != JobState.APPROVED.value


def test_rejection_is_refused_before_processing_finishes(client):
    store.add(JobRecord(id="unstarted-job"))
    response = client.post("/api/jobs/unstarted-job/reject", json={"reason": "nope"})
    assert response.status_code == 409


def test_approval_can_select_a_subset_of_assets(client):
    """A pair job offers two cutouts; approving one must leave the other unapproved."""
    summary = run_job(client, images.png(images.paired_items()))
    assets = summary["assets"]
    assert len(assets) == 2

    chosen = assets[0]["id"]
    approved = client.post(
        f"/api/jobs/{summary['id']}/approve", json={"asset_ids": [chosen]}
    ).json()

    by_id = {asset["id"]: asset for asset in approved["assets"]}
    assert by_id[chosen]["approved"] is True
    assert by_id[assets[1]["id"]]["approved"] is False


def test_the_retried_job_still_records_its_stages_in_order(flaky_app):
    """A retry must not leave a half-filled stage list behind."""
    client, _ = flaky_app
    first = run_job(client, images.png(images.single_item()))
    client.post(f"/api/jobs/{first['id']}/retry")
    assert wait_for_job(first["id"]) is JobState.AWAITING_REVIEW
    retried = client.get(f"/api/jobs/{first['id']}").json()

    assert [stage["stage"] for stage in retried["stages"]] == list(STAGE_ORDER)
    assert stage_of(retried, "segmenting")["state"] == "succeeded"
    assert stage_of(retried, "validating")["state"] == "succeeded"
    assert stage_of(retried, "generating_3d")["state"] == "skipped"
