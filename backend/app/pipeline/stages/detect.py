"""Stage C (decision half) — resolving single / pair / multiple.

The detector reports geometry. This module decides what that geometry *means*, and — more
importantly — when it does not mean enough to act on alone.

The governing rule: **a wrong automatic decision that the seller cannot see is worse than a
question.** So whenever the evidence is thin, or contradicts what the seller already told us, the
result is `needs_seller_confirmation=True` and the review screen asks.
"""

from __future__ import annotations

from ...providers.base import DetectedItemBox
from ...schemas import DetectedItem, ItemConfiguration

#: Two blobs whose areas differ by less than this are "the same size" — the signature of a pair.
PAIR_AREA_TOLERANCE = 0.35

#: Below this, we ask rather than assert.
CONFIDENCE_FLOOR = 0.6

#: More than this many blobs is not a product photograph.
MAX_PLAUSIBLE_ITEMS = 3


def _role_for(index: int, total: int) -> str:
    if total == 1:
        return "primary"
    if total == 2:
        return "left" if index == 0 else "right"
    return f"item_{index + 1}"


def _one_box(box: DetectedItemBox, index: int, total: int) -> DetectedItem:
    left, top, right, bottom = box.bbox
    return DetectedItem(
        index=index,
        bbox=(left, top, right, bottom),
        area_ratio=box.relative_size,
        centroid=box.centroid,
        # Confidence is about evidence for this item's *separateness*, not about what it is.
        confidence=round(min(1.0, 0.5 + 0.5 * box.relative_size), 3),
        suggested_role=_role_for(index, total),  # type: ignore[arg-type]
    )


def resolve(
    boxes: list[DetectedItemBox],
    seller_configuration: ItemConfiguration,
) -> tuple[list[DetectedItem], ItemConfiguration, bool, float, str]:
    """Return (items, resolved_configuration, needs_confirmation, confidence, explanation)."""
    total = len(boxes)
    items = [_one_box(box, i, total) for i, box in enumerate(boxes)]

    if total == 0:
        return (
            items,
            ItemConfiguration.SINGLE,
            True,
            0.0,
            "No separate items could be identified, so this needs a check before it is used.",
        )

    if total > MAX_PLAUSIBLE_ITEMS:
        return (
            items[:MAX_PLAUSIBLE_ITEMS],
            ItemConfiguration.MULTIPLE,
            True,
            0.3,
            f"{total} separate shapes were found, which is more than a product photo usually "
            "contains. Please confirm which items belong to this product.",
        )

    if total == 1:
        confidence = 0.9 if boxes[0].relative_size >= 0.99 else 0.75
        explanation = "One item was found in the image."
        if seller_configuration == ItemConfiguration.PAIR:
            return (
                items,
                ItemConfiguration.SINGLE,
                True,
                confidence,
                "You said this is a pair, but only one item could be separated — the two pieces "
                "may be touching. Confirm, or re-upload with them apart.",
            )
        return (items, ItemConfiguration.SINGLE, False, confidence, explanation)

    if total == 2:
        smaller = min(boxes[0].relative_size, boxes[1].relative_size)
        # Two blobs of similar size and similar height read as a matched pair.
        height_a = boxes[0].bbox[3] - boxes[0].bbox[1]
        height_b = boxes[1].bbox[3] - boxes[1].bbox[1]
        height_similarity = (
            min(height_a, height_b) / max(height_a, height_b) if max(height_a, height_b) else 0.0
        )
        confidence = round(min(1.0, 0.55 * smaller + 0.45 * height_similarity), 3)
        if seller_configuration == ItemConfiguration.SINGLE:
            return (
                items,
                ItemConfiguration.PAIR,
                True,
                confidence,
                "You said this is a single item, but two separate pieces were found. Confirm "
                "whether this is a pair.",
            )
        if confidence < CONFIDENCE_FLOOR:
            return (
                items,
                ItemConfiguration.PAIR,
                True,
                confidence,
                "Two pieces were found, but they differ enough that this may not be a matched "
                "pair. Please confirm.",
            )
        return (
            items,
            ItemConfiguration.PAIR,
            False,
            confidence,
            "Two similar pieces were found, which is what a pair of earrings looks like.",
        )

    # total == 3
    return (
        items,
        ItemConfiguration.MULTIPLE,
        True,
        0.45,
        "Three separate pieces were found. Please confirm which belong to this product.",
    )
