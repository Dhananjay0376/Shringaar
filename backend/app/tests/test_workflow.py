"""The MVP acceptance path, end to end.

The spec's criterion: *"A seller can upload a normal product photo, see an actual transparent cutout,
review separated items where applicable, approve a valid 2D asset, and use it in the existing try-on
system."* These tests walk exactly that path and assert each clause, including that the cutout is
**actually transparent** — measured from the returned pixels, not inferred from a 200 response.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.schemas import AssetRole, DerivedAssetKind, ItemConfiguration, JobState
from app.tests import images
from app.tests.conftest import run_job, stage_of, upload, wait_for_job
from app.jobs import store


def _fetch(client, url: str) -> Image.Image:
    response = client.get(url)
    assert response.status_code == 200, f"{url} -> {response.status_code}"
    return Image.open(io.BytesIO(response.content))


def test_pair_upload_reaches_review_with_two_cutouts(client):
    summary = run_job(client, images.png(images.paired_items()))

    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert summary["progress"] == 1.0
    assert summary["error"] is None

    cutouts = [a for a in summary["assets"] if a["kind"] == DerivedAssetKind.CUTOUT_2D.value]
    assert len(cutouts) == 2, f"expected two separated items, got {len(cutouts)}"

    roles = sorted(a["role"] for a in cutouts)
    assert roles == sorted([AssetRole.LEFT.value, AssetRole.RIGHT.value])


def test_cutout_is_actually_transparent(client):
    """The load-bearing claim. Measured from the delivered bytes."""
    summary = run_job(client, images.png(images.single_item()))
    asset = summary["assets"][0]
    assert asset["mime_type"] == "image/png"

    image = _fetch(client, asset["url"]).convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]

    assert alpha.min() == 0, "the cutout has no fully transparent pixels at all"
    assert alpha.max() == 255, "the cutout has no fully opaque pixels"
    transparent_fraction = float((alpha == 0).mean())
    assert transparent_fraction > 0.2, (
        f"only {transparent_fraction:.1%} of the cutout is transparent — the background was not "
        "removed"
    )


def test_cutout_keeps_the_item_and_drops_the_background(client):
    """Colour evidence, not just an alpha channel: the opaque pixels are the gold subject."""
    summary = run_job(client, images.png(images.single_item()))
    image = _fetch(client, summary["assets"][0]["url"]).convert("RGBA")
    pixels = np.asarray(image)
    opaque = pixels[:, :, 3] > 200

    assert opaque.any(), "nothing survived segmentation"
    mean = pixels[:, :, :3][opaque].mean(axis=0)

    # The background is near-white grey (238,236,232); the item is gold (198,152,62). The surviving
    # pixels must be much closer to the item than to the background.
    background = np.array(images.BACKGROUND, dtype=float)
    gold = np.array(images.GOLD, dtype=float)
    assert np.linalg.norm(mean - gold) < np.linalg.norm(mean - background)


def test_items_are_separated_and_cropped_independently(client):
    summary = run_job(client, images.png(images.paired_items()))
    left = next(a for a in summary["assets"] if a["role"] == AssetRole.LEFT.value)
    right = next(a for a in summary["assets"] if a["role"] == AssetRole.RIGHT.value)

    # Each crop covers one item, so each holds roughly half the subject.
    left_area = left["details"]["relative_size"]
    right_area = right["details"]["relative_size"]
    assert abs(left_area - right_area) < 0.05, "the two items should be near-identical in size"

    # Their bounding boxes must not overlap: overlapping crops would mean the separation failed.
    lb, rb = left["details"]["source_bbox"], right["details"]["source_bbox"]
    assert lb[2] <= rb[0] or rb[2] <= lb[0], f"crops overlap: {lb} and {rb}"


def test_pair_is_recognised_without_asking_the_seller(client):
    summary = run_job(client, images.png(images.paired_items()))
    detection = summary["detection"]
    assert detection["item_count"] == 2
    assert detection["resolved_configuration"] == ItemConfiguration.PAIR.value
    assert detection["needs_seller_confirmation"] is False
    assert detection["confidence"] >= 0.6


def test_single_item_configuration(client):
    summary = run_job(client, images.png(images.single_item()))
    assert summary["detection"]["item_count"] == 1
    assert summary["detection"]["resolved_configuration"] == ItemConfiguration.SINGLE.value
    assert summary["assets"][0]["role"] == AssetRole.PRIMARY.value


def test_seller_saying_single_but_two_found_needs_confirmation(client):
    summary = run_job(
        client, images.png(images.paired_items()), item_configuration="single"
    )
    detection = summary["detection"]
    assert detection["needs_seller_confirmation"] is True
    assert detection["resolved_configuration"] == ItemConfiguration.PAIR.value
    assert "confirm" in detection["explanation"].lower()

    # And the disagreement is surfaced to the seller, not buried in the JSON.
    assert any("confirm" in note.lower() for note in summary["notes"])


def test_three_items_need_confirmation(client):
    summary = run_job(client, images.png(images.three_items()))
    assert summary["detection"]["item_count"] == 3
    assert summary["detection"]["resolved_configuration"] == ItemConfiguration.MULTIPLE.value
    assert summary["detection"]["needs_seller_confirmation"] is True


def test_approval_gates_the_assets(client):
    summary = run_job(client, images.png(images.paired_items()))
    job_id = summary["id"]
    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert all(a["approved"] is False for a in summary["assets"])

    ids = [a["id"] for a in summary["assets"]]
    response = client.post(f"/api/jobs/{job_id}/approve", json={"asset_ids": ids})
    assert response.status_code == 200, response.text
    approved = response.json()

    assert approved["state"] == JobState.APPROVED.value
    assert approved["approved_at"] is not None
    assert all(a["approved"] for a in approved["assets"])

    # Approving twice is a mistake, and is refused rather than silently repeated.
    again = client.post(f"/api/jobs/{job_id}/approve", json={"asset_ids": ids})
    assert again.status_code == 409


def test_approval_can_correct_a_role(client):
    summary = run_job(client, images.png(images.paired_items()))
    job_id = summary["id"]
    target = summary["assets"][0]["id"]

    response = client.post(
        f"/api/jobs/{job_id}/approve",
        json={"asset_ids": [a["id"] for a in summary["assets"]],
              "roles": {target: AssetRole.RIGHT.value}},
    )
    assert response.status_code == 200
    updated = next(a for a in response.json()["assets"] if a["id"] == target)
    assert updated["role"] == AssetRole.RIGHT.value


def test_approval_of_an_unknown_asset_is_refused(client):
    summary = run_job(client, images.png(images.single_item()))
    response = client.post(
        f"/api/jobs/{summary['id']}/approve", json={"asset_ids": ["not-an-asset"]}
    )
    assert response.status_code == 409
    assert "not-an-asset" in response.text


def test_rejection_clears_approval(client):
    summary = run_job(client, images.png(images.single_item()))
    job_id = summary["id"]
    response = client.post(
        f"/api/jobs/{job_id}/reject", json={"reason": "Background still visible behind the hook."}
    )
    assert response.status_code == 200
    rejected = response.json()
    assert rejected["state"] == JobState.REJECTED.value
    assert all(a["approved"] is False for a in rejected["assets"])


def test_baseline_providers_are_not_labelled_simulated(client):
    """The honesty rule, checked in both directions.

    The baseline provider does real deterministic work on the real pixels, so it must NOT be marked
    simulated; the mock provider does not, so it must be. A test that only checked one direction
    would let a mislabelled provider through.
    """
    summary = run_job(client, images.png(images.single_item()))
    assert summary["simulated"] is False
    assert all(a["simulated"] is False for a in summary["assets"])
    for stage in summary["stages"]:
        if stage["provider"] is not None:
            assert stage["provider"]["simulated"] is False
            assert stage["provider"]["ml"] is False


def test_three_d_is_skipped_and_reported_not_hidden(client):
    summary = run_job(client, images.png(images.single_item()))
    stage = stage_of(summary, "generating_3d")
    assert stage["state"] == "skipped"
    assert stage["message"], "a skipped 3D stage must say why"
    assert not [a for a in summary["assets"] if a["kind"] == DerivedAssetKind.MODEL_3D.value]
    assert any("flat" in note.lower() for note in summary["notes"])


def test_original_upload_is_preserved_verbatim(client):
    source = images.png(images.single_item())
    summary = run_job(client, source)
    record = store.get(summary["id"])

    assert record.original_rel_path is not None
    from app.storage import read_bytes

    assert read_bytes(record.original_rel_path) == source
    # The original is a different file from every derived asset.
    assert record.original_rel_path not in {a["path"] for a in summary["assets"]}


@pytest.mark.parametrize(
    ("name", "data", "expected_mime"),
    [
        ("png", images.png(images.single_item()), "image/png"),
        ("jpeg", images.jpeg(images.single_item()), "image/jpeg"),
        ("webp", images.webp(images.single_item()), "image/webp"),
    ],
)
def test_accepted_formats(client, name, data, expected_mime):
    """The reported type comes from the decoded bytes, so a mislabelled file is still handled."""
    summary = run_job(client, data, filename=f"product.{name}")
    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert summary["input"]["mime_type"] == expected_mime
    assert summary["assets"], f"{name} produced no assets"


def test_format_is_taken_from_bytes_not_the_filename(client):
    """A PNG named `photo.jpg` is a real case (a mislabelled export) and must still work."""
    summary = run_job(client, images.png(images.single_item()), filename="photo.jpg")
    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert summary["input"]["mime_type"] == "image/png"


def test_pre_existing_alpha_is_honoured(client):
    summary = run_job(client, images.png(images.already_transparent()))
    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert stage_of(summary, "segmenting")["details"]["source_had_alpha"] is True

    image = _fetch(client, summary["assets"][0]["url"]).convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]
    assert alpha.max() == 255 and alpha.min() == 0


def test_asset_bytes_are_served_from_the_files_route(client):
    """The URL handed to the frontend must actually resolve to the bytes."""
    summary = run_job(client, images.png(images.single_item()))
    asset = summary["assets"][0]
    assert asset["url"].endswith(asset["path"])

    response = client.get(asset["url"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert len(response.content) == asset["size_bytes"]


def test_file_route_refuses_traversal(client):
    for path in [
        "../../../../etc/passwd",
        "..%2f..%2fdata",
        "/etc/passwd",
        "assets/../../app/main.py",
    ]:
        response = client.get(f"/files/{path}")
        assert response.status_code in (404, 400), f"{path} returned {response.status_code}"


def test_status_endpoint_reports_stages(client):
    job_id = upload(client, images.png(images.single_item())).json()["id"]
    wait_for_job(job_id)

    body = client.get(f"/api/jobs/{job_id}").json()
    assert [s["stage"] for s in body["stages"]] == [
        "validating",
        "preprocessing",
        "segmenting",
        "generating_2d",
        "generating_3d",
        "validating_assets",
    ]
    for stage in body["stages"]:
        assert stage["state"] != "pending", f"{stage['stage']} never settled"


def test_unknown_job_is_404(client):
    assert client.get("/api/jobs/does-not-exist").status_code == 404
