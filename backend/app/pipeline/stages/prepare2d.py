"""Stage D — preparing 2D assets.

Turns the cutout plus the detected boxes into individual, tightly-cropped, padded, transparent
assets ready for the try-on engine.

Two decisions worth stating:

* **Crops are taken from the cutout, never from the original.** The original has a background in it;
  cropping the original would put a rectangle of background on the customer's face.
* **Resolution is only ever reduced, never invented.** An item smaller than the target keeps its
  native size rather than being upscaled into softness — the AR engine scales the asset by the
  viewer's interocular distance anyway, and an upscaled blur looks worse than a small sharp one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from PIL import Image

from ...providers.base import CutoutResult, DetectedItemBox
from ...schemas import AssetRole

#: Padding as a fraction of the crop's long edge, so an earring hook is not clipped by the box.
PADDING_RATIO = 0.06

#: Two items are treated as a matched pair when their areas and aspect ratios agree to these
#: tolerances. Used only to *annotate* — never to discard an item.
IDENTICAL_AREA_TOLERANCE = 0.10
IDENTICAL_ASPECT_TOLERANCE = 0.15


@dataclass
class PreparedAsset:
    role: AssetRole
    image: Image.Image
    source_bbox: tuple[int, int, int, int]
    details: dict[str, Any] = field(default_factory=dict)


def _roles_for(count: int) -> list[AssetRole]:
    if count == 1:
        return [AssetRole.PRIMARY]
    if count == 2:
        return [AssetRole.LEFT, AssetRole.RIGHT]
    return [AssetRole.ITEM_1, AssetRole.ITEM_2, AssetRole.ITEM_3][:count]


def _padded_bbox(
    box: DetectedItemBox, size: tuple[int, int]
) -> tuple[int, int, int, int]:
    width, height = size
    left, top, right, bottom = box.bbox
    pad = max(2, int(round(max(right - left, bottom - top) * PADDING_RATIO)))
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(width, right + pad),
        min(height, bottom + pad),
    )


def _fit(image: Image.Image, long_edge: int) -> tuple[Image.Image, bool]:
    current = max(image.size)
    if current <= long_edge or current == 0:
        return image, False
    scale = long_edge / current
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS), True


def prepare_items(
    cutout: CutoutResult,
    boxes: list[DetectedItemBox],
    *,
    output_long_edge: int,
) -> list[PreparedAsset]:
    """Crop each detected item out of the cutout."""
    if not boxes:
        return []

    roles = _roles_for(len(boxes))
    prepared: list[PreparedAsset] = []

    for index, box in enumerate(boxes):
        bbox = _padded_bbox(box, cutout.image.size)
        left, top, right, bottom = bbox
        if right <= left or bottom <= top:
            continue
        crop = cutout.image.crop(bbox)
        fitted, was_resized = _fit(crop, output_long_edge)
        prepared.append(
            PreparedAsset(
                role=roles[index] if index < len(roles) else AssetRole.ITEM_3,
                image=fitted,
                source_bbox=bbox,
                details={
                    "source_bbox": list(bbox),
                    "padding_ratio": PADDING_RATIO,
                    "resized": was_resized,
                    "native_size": list(crop.size),
                    "relative_size": round(box.relative_size, 4),
                },
            )
        )

    _annotate_pair(prepared)
    return prepared


def _annotate_pair(assets: list[PreparedAsset]) -> None:
    """Record whether a two-item result looks like a matched pair.

    This is an annotation, not a decision: both crops are always emitted. The spec forbids
    fabricating a second copy of an asymmetric item — emitting two *real* crops and letting the
    frontend decide whether to reuse one source is the honest version of that rule.
    """
    if len(assets) != 2:
        for asset in assets:
            asset.details["identical_pair"] = False
        return

    first, second = assets
    area_a = first.details.get("relative_size", 0.0)
    area_b = second.details.get("relative_size", 0.0)
    larger = max(area_a, area_b) or 1.0
    area_similarity = abs(area_a - area_b) / larger

    aspect_a = first.image.width / first.image.height if first.image.height else 0.0
    aspect_b = second.image.width / second.image.height if second.image.height else 0.0
    aspect_larger = max(aspect_a, aspect_b) or 1.0
    aspect_similarity = abs(aspect_a - aspect_b) / aspect_larger

    identical = (
        area_similarity <= IDENTICAL_AREA_TOLERANCE
        and aspect_similarity <= IDENTICAL_ASPECT_TOLERANCE
    )

    for asset in assets:
        asset.details["identical_pair"] = identical
        asset.details["area_similarity_delta"] = round(area_similarity, 4)
        asset.details["aspect_similarity_delta"] = round(aspect_similarity, 4)
