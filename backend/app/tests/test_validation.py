"""Stage A — what the service accepts, and what it refuses.

Every rejection here is asserted on its *coded* failure, not just on a status code. "Something went
wrong" and "this is a GIF" are different facts and the seller is told which.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.pipeline.stages.validate import decode_upload
from app.schemas import FailureCode, JobState
from app.tests import images
from app.tests.conftest import run_job, stage_of, upload, wait_for_job


def _decode(data: bytes, *, max_pixels: int | None = None):
    return decode_upload(
        data,
        max_bytes=settings.max_upload_bytes,
        max_pixels=max_pixels or settings.max_image_pixels,
    )


# ---------------------------------------------------------------------------------------------
# Unit level: decode_upload
# ---------------------------------------------------------------------------------------------


def test_empty_file_is_rejected():
    result = _decode(b"")
    assert result.ok is False
    assert result.failure is FailureCode.EMPTY_FILE


def test_non_image_is_rejected_as_unsupported():
    result = _decode(images.not_an_image())
    assert result.ok is False
    assert result.failure is FailureCode.UNSUPPORTED_TYPE


def test_bytes_over_the_cap_are_rejected():
    result = decode_upload(b"x" * 100, max_bytes=50, max_pixels=10_000)
    assert result.ok is False
    assert result.failure is FailureCode.TOO_LARGE


def test_declared_dimensions_are_checked_before_decode():
    """The decompression-bomb guard.

    A 400x400 image is 160k pixels. With a 100-pixel budget the file must be refused on its header,
    which is what stops a small file claiming an enormous canvas from ever being decoded.
    """
    result = _decode(images.png(images.single_item(400, 400)), max_pixels=100)
    assert result.ok is False
    assert result.failure is FailureCode.TOO_MANY_PIXELS


def test_truncated_image_is_rejected_as_corrupt():
    result = _decode(images.truncated_png(images.paired_items()))
    assert result.ok is False
    assert result.failure in (FailureCode.CORRUPT_IMAGE, FailureCode.TOO_MANY_PIXELS)


def test_sha256_is_of_the_original_bytes():
    data = images.png(images.single_item())
    result = _decode(data)
    assert result.ok and result.value is not None
    import hashlib

    assert result.value.sha256 == hashlib.sha256(data).hexdigest()
    assert result.value.size_bytes == len(data)


def test_format_comes_from_the_bytes_not_the_filename():
    """`decode_upload` never sees a filename, which is the point — it cannot be fooled by one."""
    result = _decode(images.png(images.single_item()))
    assert result.ok and result.value is not None
    assert result.value.format == "PNG"
    assert result.value.mime_type == "image/png"


def test_exif_orientation_is_normalised():
    """A rotated phone photo must not reach the solver sideways."""
    from PIL import Image

    image = images.single_item(400, 200)
    exif = Image.Exif()
    exif[274] = 6  # orientation 6 = rotate 90° CW
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)

    result = _decode(buffer.getvalue())
    assert result.ok and result.value is not None
    # 400x200 rotated to upright becomes 200x400.
    assert result.value.image.size == (200, 400)
    assert result.value.details["orientation_normalised"] is True


def test_unrotated_image_is_not_flagged_as_rotated():
    result = _decode(images.png(images.single_item()))
    assert result.ok and result.value is not None
    assert result.value.details["orientation_normalised"] is False


# ---------------------------------------------------------------------------------------------
# API level: what the seller sees
# ---------------------------------------------------------------------------------------------


def test_upload_of_a_non_image_fails_the_job_with_a_readable_message(client):
    summary = run_job(client, images.not_an_image(), filename="invoice.pdf")
    assert summary["state"] == JobState.FAILED.value
    assert summary["error"]["code"] == FailureCode.UNSUPPORTED_TYPE.value
    assert summary["error"]["stage"] == "validating"
    assert summary["error"]["retryable"] is False
    assert "PNG" in summary["error"]["message"]


def test_empty_upload_is_refused_at_the_endpoint(client):
    response = upload(client, b"")
    assert response.status_code == 400
    assert "no file" in response.text.lower()


def test_oversized_upload_is_refused_without_buffering_it_all(client):
    payload = b"\x00" * (settings.max_upload_bytes + 1024)
    response = upload(client, payload)
    assert response.status_code == 413
    assert "limit" in response.text.lower()


def test_partial_upload_names_the_real_cause(client):
    """A half-downloaded file is a retryable problem, and the job says so."""
    summary = run_job(client, images.truncated_png(images.paired_items()))
    if summary["state"] == JobState.FAILED.value:
        assert summary["error"]["stage"] == "validating"
        assert summary["error"]["retryable"] is True


def test_an_image_with_no_subject_fails_honestly(client):
    """A blank rectangle has nothing to cut out. It must fail, not invent an asset."""
    summary = run_job(client, images.png(images.flat_colour()))
    assert summary["state"] == JobState.FAILED.value
    assert summary["error"]["code"] in (
        FailureCode.EMPTY_CUTOUT.value,
        FailureCode.LOW_FOREGROUND_RATIO.value,
    )
    assert not summary["assets"], "a failed job must not hand back assets"


def test_failed_job_reports_every_stage_as_settled(client):
    """A failure must look finished, not like a progress bar that stopped moving."""
    summary = run_job(client, images.not_an_image())
    assert summary["progress"] == 1.0
    assert all(s["state"] != "pending" for s in summary["stages"])
    assert stage_of(summary, "segmenting")["state"] == "skipped"


def test_invalid_item_configuration_is_refused(client):
    response = upload(client, images.png(images.single_item()), item_configuration="bracelet")
    assert response.status_code == 400
    assert "item_configuration" in response.text


def test_out_of_range_output_size_is_refused(client):
    response = upload(client, images.png(images.single_item()), output_long_edge="9000")
    assert response.status_code == 400


@pytest.mark.parametrize("value", ["true", "1", "yes", "on"])
def test_generate_3d_flag_is_parsed(client, value):
    """With no 3D provider available the stage is skipped, but the request is still honoured."""
    summary = run_job(client, images.png(images.single_item()), generate_3d=value)
    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert stage_of(summary, "generating_3d")["state"] == "skipped"


def test_long_edge_is_applied_and_never_upscales(client):
    """A large upload is reduced; a small one keeps its native size."""
    big = run_job(client, images.png(images.single_item(1600, 1600)), output_long_edge="512")
    asset = big["assets"][0]
    assert max(asset["width"], asset["height"]) <= 512

    small = run_job(client, images.png(images.single_item(200, 200)), output_long_edge="1024")
    asset = small["assets"][0]
    assert max(asset["width"], asset["height"]) <= 200 + 2


def test_job_carries_the_seller_s_product_fields_back(client):
    summary = run_job(
        client,
        images.png(images.single_item()),
        name="Kundan jhumka",
        category="earrings",
        anchor="ear",
        item_configuration="single",
    )
    assert summary["product"]["name"] == "Kundan jhumka"
    assert summary["product"]["category"] == "earrings"
    assert summary["product"]["anchor"] == "ear"
    assert summary["product"]["item_configuration"] == "single"


def test_status_url_from_creation_resolves(client):
    created = upload(client, images.png(images.single_item())).json()
    assert client.get(created["status_url"]).status_code == 200
    wait_for_job(created["id"])
