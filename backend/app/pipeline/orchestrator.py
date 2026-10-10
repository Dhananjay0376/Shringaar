"""Pipeline orchestration.

Runs the staged job and owns every policy decision the providers deliberately do not make:

* **A failed 3D stage never fails the job.** The spec is explicit that a valid 2D asset must be
  usable even when 3D generation fails or is unavailable, so `generating_3d` is recorded as
  `skipped`/`failed` with a reason and processing continues.
* **A failed validation or segmentation does fail the job**, because there is nothing usable to
  hand the seller and pretending otherwise would produce an asset that does not exist.
* **Nothing is published here.** The job parks in `awaiting_review`; a seller approval is a
  separate, explicit call. Generated 3D assets are never usable before that.
* **A crash marks the job failed.** The whole run is wrapped so an unexpected exception leaves a
  job in `failed` with a code, rather than stuck in `running` forever.
"""

from __future__ import annotations

import io
import traceback

import numpy as np
from PIL import Image

from ..config import settings
from ..jobs import JobRecord, store
from ..providers import ProviderSet
from ..providers.base import CutoutResult
from ..schemas import (
    STAGE_ORDER,
    DerivedAsset,
    DerivedAssetKind,
    DetectionSummary,
    FailureCode,
    InputSummary,
    JobError,
    JobState,
    ProviderInfo,
    StageState,
)
from ..storage import public_url, read_bytes, write_bytes
from .glb import inspect_glb
from .stages import detect as detect_stage
from .stages import prepare2d
from .stages.validate import decode_upload

#: Generated 3D files are capped here as well as at validation time — two checks, because the
#: writer is not trusted to respect the limit on its own.
MAX_GLB_BYTES = 25 * 1024 * 1024


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    # optimize=False: the assets are large photographic cutouts, where optimization buys little and
    # costs measurable CPU on every job.
    image.save(buffer, format="PNG", optimize=False)
    return buffer.getvalue()


def _fail(
    record: JobRecord,
    stage: str,
    code: FailureCode,
    message: str,
    *,
    retryable: bool,
    detail: str | None = None,
    provider: ProviderInfo | None = None,
) -> None:
    record.close_stage(stage, state=StageState.FAILED, message=message, provider=provider)
    record.error = JobError(
        code=code, stage=stage, message=message, retryable=retryable, detail=detail
    )
    # Stages the run never reached are marked skipped rather than left pending, so progress settles
    # at 1.0 and the UI shows a finished failure instead of a bar that creeps forever.
    if stage in STAGE_ORDER:
        _skip_remaining(record, STAGE_ORDER[STAGE_ORDER.index(stage) + 1 :], "Processing stopped.")
    record.set_state(JobState.FAILED)


def _skip_remaining(record: JobRecord, stages: tuple[str, ...], reason: str) -> None:
    for name in stages:
        if record.stages[name].state is StageState.PENDING:
            record.close_stage(name, state=StageState.SKIPPED, message=reason)


def _alpha_mask(image: Image.Image) -> np.ndarray:
    """Boolean foreground mask from an RGBA image's own alpha channel."""
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    return alpha > 8


def run_job(job_id: str, providers: ProviderSet) -> None:
    """Execute a job to `awaiting_review` or `failed`. Safe to call from a worker thread."""
    record = store.get(job_id)
    record.attempts += 1
    try:
        _run(record, providers)
    except Exception as exc:  # noqa: BLE001 - a crash must not leave the job stuck in `running`
        current = record.state.value
        _fail(
            record,
            current if current in record.stages else "validating",
            FailureCode.UNKNOWN,
            "Processing stopped unexpectedly. Retrying may help; if it keeps failing, the image "
            "may be in a format this service cannot handle.",
            retryable=True,
            detail=f"{type(exc).__name__}: {exc}",
        )
        # Kept in the job record rather than logged only, so a failure is diagnosable from the API
        # without shell access to the server.
        record.stages["validating"].details["traceback"] = traceback.format_exc()[-2000:]


def _run(record: JobRecord, providers: ProviderSet) -> None:
    if record.original_rel_path is None:
        _fail(
            record,
            "validating",
            FailureCode.EMPTY_FILE,
            "This job has no uploaded file.",
            retryable=False,
        )
        return

    # -- validating ------------------------------------------------------------------------
    record.open_stage("validating")
    source = read_bytes(record.original_rel_path)
    decoded = decode_upload(
        source,
        max_bytes=settings.max_upload_bytes,
        max_pixels=settings.max_image_pixels,
    )
    if not decoded.ok or decoded.value is None:
        # A wrong file type or an empty upload will not fix itself on a retry; a truncated
        # download might.
        _fail(
            record,
            "validating",
            decoded.failure or FailureCode.UNKNOWN,
            decoded.message or "This image was rejected.",
            retryable=decoded.failure
            not in (FailureCode.UNSUPPORTED_TYPE, FailureCode.EMPTY_FILE),
            provider=decoded.info,
        )
        return

    image = decoded.value
    record.input = InputSummary(
        file_name=record.source_file_name,
        mime_type=image.mime_type,
        size_bytes=image.size_bytes,
        sha256=image.sha256,
        width=image.width,
        height=image.height,
        mode=image.image.mode,
        original_path=record.original_rel_path,
    )
    record.close_stage(
        "validating",
        state=StageState.SUCCEEDED,
        message=f"{image.format} {image.width}×{image.height} accepted.",
        provider=decoded.info,
        details=image.details,
    )

    # -- preprocessing ---------------------------------------------------------------------
    record.open_stage("preprocessing")
    try:
        working = image.image.convert("RGBA")
    except Exception as exc:
        _fail(
            record,
            "preprocessing",
            FailureCode.UNSUPPORTED_MODE,
            f"This image could not be prepared for processing ({exc}).",
            retryable=False,
        )
        return
    record.close_stage(
        "preprocessing",
        state=StageState.SUCCEEDED,
        message="Orientation and colour mode normalised.",
        details={
            "source_mode": image.image.mode,
            "working_mode": working.mode,
            "working_size": list(working.size),
        },
    )

    # -- segmenting ------------------------------------------------------------------------
    record.open_stage("segmenting")
    removal = providers.background.remove(working)
    if not removal.ok or removal.value is None:
        _fail(
            record,
            "segmenting",
            removal.failure or FailureCode.PROVIDER_ERROR,
            removal.message or "The background could not be separated.",
            retryable=True,
            provider=removal.info,
        )
        return

    cutout: CutoutResult = removal.value
    detection = providers.detector.detect(cutout)
    if not detection.ok or detection.value is None:
        _fail(
            record,
            "segmenting",
            detection.failure or FailureCode.PROVIDER_ERROR,
            detection.message or "The items in this image could not be separated.",
            retryable=True,
            provider=detection.info,
        )
        return

    boxes = detection.value.items
    items, configuration, needs_confirmation, confidence, explanation = detect_stage.resolve(
        boxes, record.product.item_configuration
    )
    record.detection = DetectionSummary(
        item_count=len(items),
        resolved_configuration=configuration,
        needs_seller_confirmation=needs_confirmation,
        confidence=confidence,
        items=items,
        provider=detection.info,
        explanation=explanation,
    )
    record.close_stage(
        "segmenting",
        state=StageState.SUCCEEDED,
        message=explanation,
        provider=removal.info,
        details={
            "foreground_ratio": round(cutout.foreground_ratio, 5),
            "source_had_alpha": cutout.source_had_alpha,
            "background": cutout.details,
            "detection": detection.value.details,
            "detection_provider": detection.info.name,
        },
    )

    # -- generating_2d ---------------------------------------------------------------------
    record.open_stage("generating_2d")
    prepared = prepare2d.prepare_items(
        cutout, boxes, output_long_edge=record.long_edge
    )
    if not prepared:
        _fail(
            record,
            "generating_2d",
            FailureCode.EMPTY_CUTOUT,
            "The separated areas were too small to build an asset from.",
            retryable=True,
        )
        return

    for index, item in enumerate(prepared):
        data = _png_bytes(item.image)
        filename = f"cutout-{item.role.value}-{index}.png"
        stored = write_bytes(record.id, kind="assets", filename=filename, data=data)
        record.assets.append(
            DerivedAsset(
                id=f"{record.id}-2d-{index}",
                kind=DerivedAssetKind.CUTOUT_2D,
                role=item.role,
                path=stored.rel_path,
                url=public_url(stored.rel_path),
                mime_type="image/png",
                size_bytes=stored.size_bytes,
                width=item.image.width,
                height=item.image.height,
                simulated=removal.info.simulated,
                provider=removal.info,
                details=dict(item.details),
            )
        )

    record.close_stage(
        "generating_2d",
        state=StageState.SUCCEEDED,
        message=(
            f"{len(prepared)} transparent asset{'s' if len(prepared) != 1 else ''} prepared."
        ),
        provider=removal.info,
        details={"asset_count": len(prepared), "format": "png", "alpha": "straight"},
    )

    # -- generating_3d (optional, never fatal) ---------------------------------------------
    record.open_stage("generating_3d")
    if not record.options.generate_3d:
        record.close_stage(
            "generating_3d",
            state=StageState.SKIPPED,
            message="3D generation was not requested for this product.",
            provider=providers.model3d.info(),
        )
    elif not providers.model3d.available:
        record.close_stage(
            "generating_3d",
            state=StageState.SKIPPED,
            message=(
                "No 3D generation provider is available on this server, so this piece will use "
                "its flat image in try-on."
            ),
            provider=providers.model3d.info(),
        )
    else:
        generator_info = providers.model3d.info()
        generated = 0
        for index, item in enumerate(prepared):
            # A per-item cutout, so a generator sees one piece rather than the whole sheet. The
            # mask is this item's own alpha, not the source cutout's — they are different shapes.
            one_cutout = CutoutResult(
                image=item.image,
                mask=_alpha_mask(item.image),
                foreground_ratio=cutout.foreground_ratio,
                source_had_alpha=True,
                details=dict(item.details),
            )
            result = providers.model3d.generate(one_cutout)
            if not result.ok or result.value is None:
                # Surfaced as a note, not as a job failure: the 2D asset is already valid.
                record.stages["generating_3d"].details.setdefault("failures", []).append(
                    {
                        "role": item.role.value,
                        "code": (result.failure or FailureCode.THREE_D_FAILED).value,
                        "message": result.message,
                    }
                )
                continue

            data = result.value.glb_bytes
            filename = f"model-{item.role.value}-{index}.glb"
            stored = write_bytes(record.id, kind="assets", filename=filename, data=data)
            record.assets.append(
                DerivedAsset(
                    id=f"{record.id}-3d-{index}",
                    kind=DerivedAssetKind.MODEL_3D,
                    role=item.role,
                    path=stored.rel_path,
                    url=public_url(stored.rel_path),
                    mime_type="model/gltf-binary",
                    size_bytes=stored.size_bytes,
                    simulated=generator_info.simulated,
                    provider=generator_info,
                    details=dict(result.value.details),
                )
            )
            generated += 1

        if generated:
            record.close_stage(
                "generating_3d",
                state=StageState.SUCCEEDED,
                message=f"{generated} 3D file(s) generated as placeholders.",
                provider=generator_info,
                details={"generated": generated, "is_billboard": True, "reconstruction": False},
            )
        else:
            record.close_stage(
                "generating_3d",
                state=StageState.FAILED,
                message="3D generation did not produce a usable file; the flat asset will be used.",
                provider=generator_info,
            )

    # -- validating_assets -----------------------------------------------------------------
    record.open_stage("validating_assets")
    rejected: list[dict[str, str]] = []
    rejected_3d: list[str] = []
    kept: list[DerivedAsset] = []
    for asset in record.assets:
        if asset.kind is DerivedAssetKind.MODEL_3D:
            inspection = inspect_glb(
                read_bytes(asset.path), max_bytes=MAX_GLB_BYTES
            )
            asset.details["inspection"] = inspection.stats
            if not inspection.ok:
                rejected.append({"asset": asset.id, "reason": inspection.reason or "invalid"})
                rejected_3d.append(inspection.reason or "the file was not a usable glTF container")
                continue
            asset.details["validated"] = True
        else:
            ok, reason = _check_cutout(asset.path)
            asset.details["validated"] = ok
            if not ok:
                rejected.append({"asset": asset.id, "reason": reason})
                continue
        kept.append(asset)

    record.assets = kept

    # The 3D stage reported success on the strength of having *written* a file. Now that the file
    # has been inspected and thrown away, leaving that stage marked `succeeded` would tell the
    # seller something untrue — and `_build_notes` reads this state to decide what to say about the
    # flat asset, so a stale success would also suppress the sentence that explains it.
    if rejected_3d:
        stage = record.stages["generating_3d"]
        stage.details["rejected"] = rejected_3d
        if stage.state is StageState.SUCCEEDED:
            record.close_stage(
                "generating_3d",
                state=StageState.FAILED,
                message=(
                    "The 3D file this stage produced did not pass validation and was discarded, so "
                    f"this piece will use its flat image. Reason: {rejected_3d[0]}"
                ),
            )

    if not any(a.kind is DerivedAssetKind.CUTOUT_2D for a in record.assets):
        _fail(
            record,
            "validating_assets",
            FailureCode.EMPTY_CUTOUT,
            "No usable try-on asset could be produced from this image.",
            retryable=True,
            detail="; ".join(r["reason"] for r in rejected) or None,
        )
        return

    record.close_stage(
        "validating_assets",
        state=StageState.SUCCEEDED,
        message=(
            f"{len(record.assets)} asset(s) validated."
            + (f" {len(rejected)} rejected." if rejected else "")
        ),
        details={"validated": len(record.assets), "rejected": rejected},
    )

    # -- awaiting review -------------------------------------------------------------------
    record.notes = _build_notes(record)
    record.error = None
    record.set_state(JobState.AWAITING_REVIEW)


def _check_cutout(rel_path: str) -> tuple[bool, str]:
    """Re-open a written cutout and confirm it is a real, non-empty PNG with alpha."""
    try:
        with Image.open(io.BytesIO(read_bytes(rel_path))) as image:
            if image.format != "PNG":
                return False, "the asset was not written as a PNG"
            if image.width < 8 or image.height < 8:
                return False, f"the asset is too small ({image.width}×{image.height})"
            if image.mode not in ("RGBA", "LA", "P"):
                return False, f"the asset has no alpha channel (mode {image.mode})"
    except Exception as exc:  # noqa: BLE001
        return False, f"the asset could not be re-read ({exc})"
    return True, "ok"


def _build_notes(record: JobRecord) -> list[str]:
    """Plain-language lines the review screen shows verbatim.

    These are the sentences that stop a placeholder being mistaken for a finished asset, so they
    are generated here rather than left to each client to invent.
    """
    notes: list[str] = []

    if record.simulated:
        notes.append(
            "These assets came from a simulated provider. Nothing in this image was actually "
            "analysed — this output is for testing the workflow only."
        )

    if record.detection is not None and record.detection.needs_seller_confirmation:
        notes.append(record.detection.explanation)

    three_d = [a for a in record.assets if a.kind is DerivedAssetKind.MODEL_3D]
    if three_d and all(a.details.get("is_billboard") for a in three_d):
        notes.append(
            "The 3D file is your cutout on a flat card, not a 3D model rebuilt from the photo. "
            "No depth or shape was inferred from the image."
        )
    elif not three_d:
        stage = record.stages["generating_3d"]
        # Skipped and failed are both "you are getting a flat asset", and the seller is told which.
        if stage.state in (StageState.SKIPPED, StageState.FAILED):
            notes.append("This product will be used as a flat try-on image. " + (stage.message or ""))

    if record.assets and all(a.kind is DerivedAssetKind.CUTOUT_2D for a in record.assets):
        notes.append(
            "The try-on view is a flat overlay: it does not turn with the head the way a real 3D "
            "model would."
        )

    notes.append("Approve these assets to make them available for try-on.")
    return notes


__all__ = ["run_job", "MAX_GLB_BYTES"]
