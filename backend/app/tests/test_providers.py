"""Providers: what each one actually computes, and how it is labelled.

The two things this file exists to protect:

1. **The baseline provider does real work.** It is not a stub with a nicer name — these tests call
   it directly and measure its output. If it were replaced by something canned, they fail.
2. **Labelling is honest in both directions.** A provider that did real work must not be marked
   simulated (that is overclaiming in reverse, and it makes the flag meaningless), and one that did
   not must be.
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from app.jobs import JobRecord, store
from app.pipeline.stages.validate import decode_upload
from app.providers import ProviderSet
from app.providers import baseline, mock
from app.providers.base import CutoutResult, Outcome
from app.schemas import FailureCode, JobState
from app.storage import write_bytes
from app.tests import images
from app.tests.conftest import run_job, stage_of, wait_for_job


def _cutout(image: Image.Image) -> CutoutResult:
    result = baseline.BaselineBackgroundRemover().remove(image.convert("RGBA"))
    assert result.ok and result.value is not None, result.message
    return result.value


# ---------------------------------------------------------------------------------------------
# Baseline background removal — real work on real pixels
# ---------------------------------------------------------------------------------------------


def test_baseline_removes_the_background():
    cutout = _cutout(images.single_item())
    alpha = np.asarray(cutout.image)[:, :, 3]

    # Corners are background, the centre is the item.
    assert alpha[0, 0] == 0
    assert alpha[-1, -1] == 0
    assert alpha[alpha.shape[0] // 2, alpha.shape[1] // 2] == 255
    assert 0.0 < cutout.foreground_ratio < 1.0


def test_baseline_reports_itself_as_real_not_simulated():
    info = baseline.BaselineBackgroundRemover().info()
    assert info.simulated is False
    assert info.ml is False
    assert info.note


def test_baseline_honours_existing_alpha():
    """An already-transparent PNG must not be re-derived and lose its soft edges."""
    source = images.already_transparent()
    cutout = _cutout(source)
    assert cutout.source_had_alpha is True

    alpha = np.asarray(cutout.image)[:, :, 3]
    assert alpha[0, 0] == 0
    assert alpha.max() == 255


def test_flat_image_produces_an_empty_cutout_failure():
    """A blank rectangle has no subject. It must fail, not invent one."""
    result = baseline.BaselineBackgroundRemover().remove(images.flat_colour().convert("RGBA"))
    assert result.ok is False
    assert result.failure in (FailureCode.EMPTY_CUTOUT, FailureCode.LOW_FOREGROUND_RATIO)
    assert result.value is None


def test_otsu_finds_the_gap_in_a_bimodal_histogram():
    """The threshold is computed, not guessed — checked against a distribution with a known split."""
    values = np.concatenate(
        [np.full(500, 20, dtype=np.uint8), np.full(500, 200, dtype=np.uint8)]
    )
    threshold = baseline._otsu_threshold(values)
    assert 20 < threshold < 200


def test_otsu_on_uniform_input_still_returns_a_threshold():
    """A degenerate histogram must not divide by zero or return None.

    The midpoint of the empty split is the honest answer here, so the assertion is "a usable number
    in range", not "an int" — the caller only multiplies it.
    """
    threshold = baseline._otsu_threshold(np.full(100, 77, dtype=np.uint8))
    assert isinstance(threshold, float)
    assert 0 <= threshold <= 255


def test_background_estimate_uses_the_border():
    """A subject that touches one edge must not drag the background estimate toward itself."""
    image = Image.new("RGB", (200, 200), images.BACKGROUND)
    # A dark block anchored on the left edge only.
    for x in range(0, 40):
        for y in range(60, 140):
            image.putpixel((x, y), images.DARK)

    distance = baseline._background_distance(np.asarray(image.convert("RGB")))
    # Background pixels are close to the estimate; the block is far from it.
    assert distance[10, 10] < 0.1
    assert distance[100, 10] > 0.2


# ---------------------------------------------------------------------------------------------
# Baseline detection — real connected components
# ---------------------------------------------------------------------------------------------


def test_detector_counts_one_two_and_three_items():
    provider = baseline.BaselineObjectDetector()
    for image, expected in (
        (images.single_item(), 1),
        (images.paired_items(), 2),
        (images.three_items(), 3),
    ):
        result = provider.detect(_cutout(image))
        assert result.ok and result.value is not None
        assert len(result.value.items) == expected, f"{expected} items expected"


def test_detector_sorts_left_to_right():
    """Role assignment reads the list in order, so a left-to-right sort is what makes it intuitive."""
    result = baseline.BaselineObjectDetector().detect(_cutout(images.three_items()))
    assert result.ok and result.value is not None
    centroids = [item.centroid[0] for item in result.value.items]
    assert centroids == sorted(centroids)


def test_detector_caps_the_item_count():
    """More than three is not a product photograph, so extras are dropped rather than reported."""
    image = images.flat_colour(600, 300)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    for left in (10, 160, 310, 460):
        draw.ellipse((left, 100, left + 120, 220), fill=images.GOLD)

    result = baseline.BaselineObjectDetector().detect(_cutout(image))
    assert result.ok and result.value is not None
    assert len(result.value.items) <= baseline.MAX_ITEMS
    assert result.value.details["components_found"] >= 4
    assert result.value.details["components_kept"] <= baseline.MAX_ITEMS


def test_relative_size_is_normalised_to_the_largest():
    result = baseline.BaselineObjectDetector().detect(_cutout(images.asymmetric_pair()))
    assert result.ok and result.value is not None
    assert len(result.value.items) == 2
    assert max(item.relative_size for item in result.value.items) == pytest.approx(1.0, abs=0.02)


# ---------------------------------------------------------------------------------------------
# Baseline 3D — refuses rather than fabricates
# ---------------------------------------------------------------------------------------------


def test_baseline_3d_is_unavailable_and_says_so():
    provider = baseline.BaselineModel3DGenerator()
    assert provider.available is False

    result = provider.generate(_cutout(images.single_item()))
    assert result.ok is False
    assert result.failure is FailureCode.PROVIDER_UNAVAILABLE
    assert result.value is None, "an unavailable provider must never return a model"


# ---------------------------------------------------------------------------------------------
# Mock — labelled, and never mistakable for the real thing
# ---------------------------------------------------------------------------------------------


def test_mock_providers_all_report_themselves_simulated():
    assert mock.MockBackgroundRemover().info().simulated is True
    assert mock.MockObjectDetector().info().simulated is True
    assert mock.MockModel3DGenerator(enabled=True).info().simulated is True
    assert mock.MockBackgroundRemover().info().ml is False


def test_mock_cutout_is_stamped_with_a_visible_watermark():
    """The label is in the pixels, so a cutout that escapes its JSON is still identifiable."""
    result = mock.MockBackgroundRemover().remove(images.single_item().convert("RGBA"))
    assert result.ok and result.value is not None
    assert result.value.details["watermark"] == mock.WATERMARK

    pixels = np.asarray(result.value.image.convert("RGB")).reshape(-1, 3)
    # The watermark plate is a strong red; nothing in the source image is.
    reds = ((pixels[:, 0] > 140) & (pixels[:, 1] < 80) & (pixels[:, 2] < 80)).sum()
    assert reds > 50, "no red watermark plate found in the simulated cutout"


def test_mock_mask_is_synthetic_and_sized_to_the_request():
    for count in (1, 2, 3):
        result = mock.MockBackgroundRemover(item_count=count).remove(
            images.single_item().convert("RGBA")
        )
        assert result.ok and result.value is not None
        assert result.value.details["synthetic_item_count"] == count
        # Two or more ellipses are drawn with a gap, so the real component analysis can split them.
        detected = baseline.BaselineObjectDetector().detect(result.value)
        assert detected.ok and detected.value is not None
        assert len(detected.value.items) == count


def test_mock_3d_is_disabled_by_default():
    provider = mock.MockModel3DGenerator()
    assert provider.available is False
    assert "switched off" in provider.info().note


def test_health_reports_a_configured_but_disabled_provider_as_unavailable():
    """The name alone is not enough: an operator must not read `/health` and assume 3D is running."""
    disabled = ProviderSet(
        name="mock",
        background=mock.MockBackgroundRemover(),
        detector=mock.MockObjectDetector(),
        model3d=mock.MockModel3DGenerator(enabled=False),
    )
    described = disabled.describe()
    assert described["model_3d"] == "mock-billboard-3d"
    assert described["model_3d_available"] == "no"

    enabled = ProviderSet(
        name="mock",
        background=mock.MockBackgroundRemover(),
        detector=mock.MockObjectDetector(),
        model3d=mock.MockModel3DGenerator(enabled=True),
    )
    assert enabled.describe()["model_3d_available"] == "yes"

    # The baseline set has no 3D provider at all, and says so through the same field.
    from app.config import load_settings
    from app.providers import build_providers

    assert build_providers(load_settings()).describe()["model_3d_available"] == "no"


def test_mock_item_count_is_configurable_from_the_environment(monkeypatch):
    """The pair branch must be reachable through the running service, not only from a test.

    `MockBackgroundRemover(item_count=…)` was constructible but never constructed with anything but
    the default, so every HTTP run drew a single blob and the review screen's pair path — the one it
    exists for — could not be driven end-to-end at all.
    """
    from app.config import load_settings
    from app.providers import build_providers

    monkeypatch.setenv("ASSET_PROVIDER", "mock")

    monkeypatch.setenv("ASSET_MOCK_ITEM_COUNT", "2")
    pair = build_providers(load_settings())
    assert pair.background.synthetic_item_count == 2
    assert pair.describe()["background_items"] == "2"

    # Out of range is clamped into the band the provider can actually draw, rather than drawing
    # nothing (0) or more blobs than it has branches for (9).
    monkeypatch.setenv("ASSET_MOCK_ITEM_COUNT", "9")
    assert build_providers(load_settings()).background.synthetic_item_count == 3
    monkeypatch.setenv("ASSET_MOCK_ITEM_COUNT", "0")
    assert build_providers(load_settings()).background.synthetic_item_count == 1

    # A malformed value falls back to the default instead of failing at import.
    monkeypatch.setenv("ASSET_MOCK_ITEM_COUNT", "two")
    assert build_providers(load_settings()).background.synthetic_item_count == 1


def test_the_baseline_provider_set_reports_no_synthetic_item_count():
    """The field describes the mock's fabrication, so a real provider must not carry it — a
    baseline run that reported a blob count would be describing work it did not do."""
    from app.config import load_settings
    from app.providers import build_providers

    assert "background_items" not in build_providers(load_settings()).describe()


def test_mock_3d_produces_a_real_valid_glb():
    """The file is genuine — it is the *reconstruction* that is absent, and that is what is labelled."""
    from app.pipeline.glb import inspect_glb

    provider = mock.MockModel3DGenerator(enabled=True)
    result = provider.generate(_cutout(images.single_item()))
    assert result.ok and result.value is not None

    inspection = inspect_glb(result.value.glb_bytes)
    assert inspection.ok is True, inspection.reason

    details = result.value.details
    assert details["is_billboard"] is True
    assert details["reconstruction"] is False
    assert "no depth" in details["note"].lower()


# ---------------------------------------------------------------------------------------------
# The same rules, through the API
# ---------------------------------------------------------------------------------------------


@pytest.fixture
def mock_providers() -> ProviderSet:
    return ProviderSet(
        name="mock",
        background=mock.MockBackgroundRemover(item_count=2),
        detector=mock.MockObjectDetector(),
        model3d=mock.MockModel3DGenerator(enabled=True),
    )


def test_a_mock_job_is_marked_simulated_end_to_end(client, mock_providers, monkeypatch):
    """The flag has to survive the whole way to the review payload, or the UI cannot show it."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    app.state.providers = mock_providers
    with TestClient(app) as mocked:
        summary = run_job(mocked, images.png(images.single_item()), generate_3d="true")

    assert summary["state"] == JobState.AWAITING_REVIEW.value
    assert summary["simulated"] is True
    assert all(asset["simulated"] for asset in summary["assets"])
    assert any("simulated" in note.lower() for note in summary["notes"])


def test_a_mock_job_produces_a_valid_3d_asset(client, mock_providers):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.schemas import DerivedAssetKind

    app = create_app()
    app.state.providers = mock_providers
    with TestClient(app) as mocked:
        summary = run_job(mocked, images.png(images.single_item()), generate_3d="true")

    three_d = [a for a in summary["assets"] if a["kind"] == DerivedAssetKind.MODEL_3D.value]
    # One model per detected item, not one per job — the shared fixture draws two.
    assert len(three_d) == summary["detection"]["item_count"] == 2
    for asset in three_d:
        assert asset["details"]["validated"] is True
        # The inspection stats are stored on the asset, so a reviewer can see what was checked.
        assert asset["details"]["inspection"]["vertices"] == 4
        assert asset["details"]["inspection"]["size_bytes"] == asset["size_bytes"]
    assert stage_of(summary, "generating_3d")["state"] == "succeeded"
    assert not stage_of(summary, "validating_assets")["details"]["rejected"]

    # Each generated model is fetchable and is a real GLB.
    from app.pipeline.glb import inspect_glb

    for asset in three_d:
        response = mocked.get(asset["url"])
        assert response.status_code == 200
        assert inspect_glb(response.content).ok is True
    # And they are labelled, so they cannot be mistaken for reconstructions.
    assert any("flat card" in note.lower() for note in summary["notes"])


def test_mock_job_assets_are_approved_only_after_review(client, mock_providers):
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    app.state.providers = mock_providers
    with TestClient(app) as mocked:
        summary = run_job(mocked, images.png(images.single_item()), generate_3d="true")
        assert summary["state"] == JobState.AWAITING_REVIEW.value
        assert all(a["approved"] is False for a in summary["assets"])

        approved = mocked.post(
            f"/api/jobs/{summary['id']}/approve",
            json={"asset_ids": [a["id"] for a in summary["assets"]]},
        ).json()
        assert approved["state"] == JobState.APPROVED.value
        assert all(a["approved"] for a in approved["assets"])


def test_invalid_glb_never_reaches_the_seller(client):
    """If the 3D stage produced something unusable, it is dropped rather than offered.

    The interesting part is the *second* half: the stage wrote a file, so it reports success — and
    once validation has thrown that file away, the stage must be corrected and the seller told.
    A stale `succeeded` here would be a claim about output that no longer exists.
    """
    broken = mock.MockModel3DGenerator(enabled=True)

    def generate_broken(cutout: CutoutResult) -> Outcome:
        good = broken.generate(cutout)
        assert good.ok and good.value is not None
        # Truncate the file the way a partial write would.
        good.value.glb_bytes = good.value.glb_bytes[: len(good.value.glb_bytes) // 2]
        return good

    providers = ProviderSet(
        name="mock",
        background=mock.MockBackgroundRemover(item_count=1),
        detector=mock.MockObjectDetector(),
        model3d=mock.MockModel3DGenerator(enabled=True),
    )
    providers.model3d.generate = generate_broken  # type: ignore[method-assign]

    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.schemas import DerivedAssetKind

    app = create_app()
    app.state.providers = providers
    with TestClient(app) as mocked:
        summary = run_job(mocked, images.png(images.single_item()), generate_3d="true")

    assert summary["state"] == JobState.AWAITING_REVIEW.value, "2D must survive a bad 3D file"
    assert not [a for a in summary["assets"] if a["kind"] == DerivedAssetKind.MODEL_3D.value]
    assert summary["assets"], "the 2D asset must still be offered"

    # The rejection is recorded, and the stage that produced the discarded file no longer claims it.
    assert stage_of(summary, "validating_assets")["details"]["rejected"]
    three_d_stage = stage_of(summary, "generating_3d")
    assert three_d_stage["state"] == "failed"
    assert three_d_stage["details"]["rejected"]
    assert "discarded" in (three_d_stage["message"] or "")

    # And the seller is told what they are actually getting.
    assert any(
        "flat try-on image" in note.lower() for note in summary["notes"]
    ), summary["notes"]


def test_the_pipeline_runs_on_a_real_decoded_upload():
    """A guard against the tests drifting away from the code path the API actually uses."""
    data = images.png(images.paired_items())
    decoded = decode_upload(data, max_bytes=10 * 1024 * 1024, max_pixels=50_000_000)
    assert decoded.ok and decoded.value is not None

    record = JobRecord(id=store.new_id())
    stored = write_bytes(record.id, kind="uploads", filename="source.upload", data=data)
    record.original_rel_path = stored.rel_path
    assert record.input is None  # not yet populated; the pipeline fills it in

    from app.pipeline import run_job

    store.add(record)
    run_job(record.id, ProviderSet(
        name="baseline",
        background=baseline.BaselineBackgroundRemover(),
        detector=baseline.BaselineObjectDetector(),
        model3d=baseline.BaselineModel3DGenerator(),
    ))
    assert record.state is JobState.AWAITING_REVIEW
    assert record.input is not None
    assert record.input.sha256 == decoded.value.sha256
