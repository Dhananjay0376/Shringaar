"""The baseline provider set: real, deterministic, non-ML image processing.

**What this is.** A background keyer and a connected-component analyser. Both genuinely read the
seller's pixels and produce a genuine transparent PNG and genuine item boxes. Neither is a
trained model, and neither is described as one anywhere in the API.

**What this is not.** It is not U²-Net, not rembg, not a matting network. It will do a good job on
the upload format the form recommends (one item, plain contrasting background) and a poor job on a
busy background, a reflective surface, or a fine chain against a similar colour. When it fails it
says so — `EMPTY_CUTOUT` — rather than emitting a mostly-empty cutout.

**Why it exists at all.** The MVP acceptance criterion is that a seller sees an *actual* transparent
cutout. A provider that returned a canned image would satisfy the API shape while making that
criterion false. This one makes it true, and is honest about its tier: `quality_tier: "baseline"`.

Replacing it is a one-line change in `providers/__init__.py`.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

from ..schemas import FailureCode, ProviderInfo
from .base import (
    CutoutResult,
    DetectedItemBox,
    DetectionOutcome,
    Model3DResult,
    Outcome,
)

VERSION = "0.1.0"

#: Below this fraction of foreground pixels the cutout is treated as a failure, not a result.
MIN_FOREGROUND_RATIO = 0.005

#: Components smaller than this fraction of the largest component are treated as speckle.
SPECKLE_RATIO = 0.02

#: Working resolution cap. The mask is computed here, then applied to the full-size image, so a
#: large upload costs bounded time without losing output resolution.
WORK_LONG_EDGE = 2048

#: The schema defines roles for at most three items, and a product photograph with more blobs than
#: this is a photograph of something else. Extras are dropped rather than reported.
MAX_ITEMS = 3


def _info(name: str, note: str) -> ProviderInfo:
    return ProviderInfo(
        name=name,
        version=VERSION,
        simulated=False,
        ml=False,
        note=note,
    )


def _otsu_threshold(values: np.ndarray, bins: int = 256) -> float:
    """Otsu's method on a 0..255 intensity array.

    Chosen over a fixed threshold because the correct split depends entirely on how different the
    jewellery is from its background, which varies per upload. Otsu finds that split from the
    image's own histogram, so a gold item on cream and a silver item on black both work.
    """
    hist, edges = np.histogram(values, bins=bins, range=(0.0, 255.0))
    hist = hist.astype(np.float64)
    total = hist.sum()
    if total <= 0:
        return 127.5
    centres = (edges[:-1] + edges[1:]) / 2.0
    weight_bg = np.cumsum(hist)
    weight_fg = total - weight_bg
    # Where either side is empty the between-class variance is undefined; mask those out.
    valid = (weight_bg > 0) & (weight_fg > 0)
    if not np.any(valid):
        return 127.5
    cum_mean = np.cumsum(hist * centres)
    mean_bg = np.divide(cum_mean, weight_bg, out=np.zeros_like(cum_mean), where=weight_bg > 0)
    mean_fg = np.divide(
        (cum_mean[-1] - cum_mean),
        weight_fg,
        out=np.zeros_like(cum_mean),
        where=weight_fg > 0,
    )
    variance = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
    variance[~valid] = -1.0
    return float(centres[int(np.argmax(variance))])


def _background_distance(rgb: np.ndarray) -> np.ndarray:
    """Euclidean RGB distance from the estimated background colour, as 0..255 float.

    The background is estimated from a border band rather than from a corner pixel: a corner can
    land on a shadow, a watermark, or the item itself, and one bad sample would mis-key the whole
    image. A median over the border is robust to a minority of such pixels.
    """
    h, w = rgb.shape[:2]
    band = max(2, int(round(min(h, w) * 0.02)))
    border = np.concatenate(
        [
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ]
    )
    if border.size == 0:
        return np.zeros((h, w), dtype=np.float32)
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb.astype(np.float32) - background, axis=-1)
    # Scale so a distance of 255 is "as different as RGB allows" — keeps Otsu in familiar units.
    return np.clip(distance * (255.0 / 441.673), 0.0, 255.0).astype(np.float32)


def _downscale_for_work(image: Image.Image) -> tuple[Image.Image, float]:
    long_edge = max(image.size)
    if long_edge <= WORK_LONG_EDGE:
        return image, 1.0
    scale = WORK_LONG_EDGE / long_edge
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS), scale


class BaselineBackgroundRemover:
    """Border-median colour keying with an Otsu split and a soft alpha ramp."""

    def info(self) -> ProviderInfo:
        return _info(
            "baseline-background-key",
            "Deterministic background keying. Not a trained segmentation model.",
        )

    def remove(self, source: Image.Image) -> Outcome[CutoutResult]:
        info = self.info()
        try:
            rgba = source.convert("RGBA")
        except Exception as exc:  # pragma: no cover - Pillow raises a variety of types
            return Outcome.error(
                info,
                FailureCode.UNSUPPORTED_MODE,
                f"This image could not be read as RGBA ({exc}).",
            )

        work, _scale = _downscale_for_work(rgba)
        arr = np.asarray(work).astype(np.float32)
        rgb = arr[..., :3]
        existing_alpha = arr[..., 3]

        # An upload that already has real transparency is respected. Re-deriving a mask from a
        # cut-out PNG would key against the transparent region's colour and destroy the edges.
        source_had_alpha = bool(existing_alpha.min() < 250.0)

        distance = _background_distance(rgb)
        threshold = _otsu_threshold(distance)
        # A soft ramp around the Otsu split: hard thresholding produces stair-stepped edges that
        # are very visible when the cutout is drawn at ear size.
        low = max(1.0, threshold * 0.6)
        high = max(low + 1.0, threshold * 1.4)
        ramp = np.clip((distance - low) / (high - low), 0.0, 1.0)

        if source_had_alpha:
            alpha = np.maximum(ramp * 255.0, existing_alpha)
        else:
            alpha = ramp * 255.0

        mask = alpha > 127.0

        # Remove speckle: isolated pixels the keyer caught in a noisy background.
        labelled, count = ndimage.label(mask)
        dropped = 0
        if count > 1:
            areas = ndimage.sum(mask, labelled, index=np.arange(1, count + 1))
            largest = float(areas.max()) if areas.size else 0.0
            if largest > 0:
                keep = np.zeros(count + 1, dtype=bool)
                for idx, area in enumerate(areas, start=1):
                    if area >= largest * SPECKLE_RATIO:
                        keep[idx] = True
                    else:
                        dropped += 1
                mask = keep[labelled]
                alpha = np.where(mask, alpha, 0.0)

        # Close 1px holes so the item is not perforated by a texture highlight that happens to
        # match the background colour.
        mask = ndimage.binary_closing(mask, structure=np.ones((3, 3), dtype=bool))
        alpha = np.where(mask, alpha, 0.0)

        if not mask.any():
            return Outcome.error(
                info,
                FailureCode.EMPTY_CUTOUT,
                "No jewellery could be separated from the background. Try an image with a "
                "plainer background, or one where the item fills more of the frame.",
            )

        foreground_ratio = float(mask.mean())
        if foreground_ratio < MIN_FOREGROUND_RATIO:
            return Outcome.error(
                info,
                FailureCode.LOW_FOREGROUND_RATIO,
                f"Only {foreground_ratio * 100:.2f}% of the image looks like jewellery, which is "
                "too little to build an asset from.",
            )

        # Upscale the mask back to full resolution and apply it there, so output resolution is
        # the upload's resolution rather than the working resolution.
        full_alpha = Image.fromarray(alpha.astype(np.uint8), mode="L")
        if full_alpha.size != rgba.size:
            full_alpha = full_alpha.resize(rgba.size, Image.BILINEAR)
        out = rgba.copy()
        out.putalpha(full_alpha)
        full_mask = np.asarray(full_alpha) > 127

        return Outcome.success(
            info,
            CutoutResult(
                image=out,
                mask=full_mask,
                foreground_ratio=foreground_ratio,
                source_had_alpha=source_had_alpha,
                details={
                    "method": "border-median background key + Otsu split",
                    "otsu_threshold": round(threshold, 2),
                    "ramp": [round(low, 2), round(high, 2)],
                    "background_estimated_from": "image border median",
                    "speckle_components_removed": int(dropped),
                    "quality_tier": "baseline",
                    "ml": False,
                },
            ),
        )


class BaselineObjectDetector:
    """Connected-component analysis over the alpha mask.

    This is real evidence, not a guess dressed as detection: two comparably-sized blobs with a
    clear horizontal separation really is what a pair photograph looks like. It is *not* semantic
    understanding — it cannot tell an earring from a bracelet, and it will merge two pieces that
    touch. The confidence it reports is a statement about blob geometry only, and the API asks the
    seller to confirm whenever that evidence is weak.
    """

    def info(self) -> ProviderInfo:
        return _info(
            "baseline-connected-components",
            "Deterministic item counting from the cutout mask. Not object recognition.",
        )

    def detect(self, cutout: CutoutResult) -> Outcome[DetectionOutcome]:
        info = self.info()
        mask = cutout.mask
        if mask.size == 0:
            return Outcome.error(info, FailureCode.EMPTY_CUTOUT, "The cutout was empty.")

        labelled, count = ndimage.label(mask)
        if count == 0:
            return Outcome.error(
                info, FailureCode.EMPTY_CUTOUT, "No distinct items were found in the cutout."
            )

        slices = ndimage.find_objects(labelled)
        areas = ndimage.sum(mask, labelled, index=np.arange(1, count + 1))
        largest = float(areas.max()) if areas.size else 0.0
        if largest <= 0:
            return Outcome.error(
                info, FailureCode.EMPTY_CUTOUT, "No distinct items were found in the cutout."
            )

        boxes: list[DetectedItemBox] = []
        for idx, area in enumerate(areas, start=1):
            if area < largest * SPECKLE_RATIO:
                continue
            region = slices[idx - 1]
            if region is None:
                continue
            top, bottom = int(region[0].start), int(region[0].stop)
            left, right = int(region[1].start), int(region[1].stop)
            centroid = ndimage.center_of_mass(mask, labelled, index=idx)
            boxes.append(
                DetectedItemBox(
                    bbox=(left, top, right, bottom),
                    area=int(area),
                    centroid=(float(centroid[1]), float(centroid[0])),
                    relative_size=float(area) / largest,
                )
            )

        boxes.sort(key=lambda b: b.area, reverse=True)
        boxes = boxes[:MAX_ITEMS]
        # Reading order left-to-right is what makes "left"/"right" assignment intuitive.
        boxes.sort(key=lambda b: b.centroid[0])

        return Outcome.success(
            info,
            DetectionOutcome(
                items=boxes,
                details={
                    "method": "connected components on the alpha mask",
                    "components_found": int(count),
                    "components_kept": len(boxes),
                },
            ),
        )


class BaselineModel3DGenerator:
    """Unavailable by construction.

    There is no real image-to-3D model wired into this service, and this class exists to say so
    through the provider interface rather than by being absent. `available` is False, so the
    pipeline records a `skipped` 3D stage with a reason, and the job still completes as 2D.
    """

    def info(self) -> ProviderInfo:
        return _info(
            "none-3d",
            "No 3D generation provider is configured. This build produces 2D assets only.",
        )

    @property
    def available(self) -> bool:
        return False

    def generate(self, cutout: CutoutResult) -> Outcome[Model3DResult]:
        return Outcome.error(
            self.info(),
            FailureCode.PROVIDER_UNAVAILABLE,
            "No 3D generation provider is configured on this server.",
        )
