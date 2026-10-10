"""The mock provider set: deterministic, clearly-labelled simulation.

**Why the labelling is this aggressive.** A simulated cutout that looks plausible is exactly the
artifact that ends up in a screenshot and gets believed. So the mock cutout is not merely flagged in
JSON — the word SIMULATED is burned into the pixels, and a seller or developer looking at the file
in isolation can tell what it is without reading any metadata.

**What is real here and what is not.** The connected-component analysis in `MockObjectDetector` is
the same real code the baseline uses; only its input is synthetic. `ProviderInfo.simulated` is True
for it anyway, because a result derived from fabricated pixels is a fabricated result.

Use this provider set to exercise failure paths, the review flow, and the API contract without
depending on any image actually being processable.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

from ..pipeline.glb import build_textured_quad_glb
from ..schemas import ProviderInfo
from .base import CutoutResult, Model3DResult, Outcome
from .baseline import BaselineObjectDetector

VERSION = "0.1.0"

#: Burned into every simulated cutout.
WATERMARK = "SIMULATED"


def _simulated(name: str, note: str) -> ProviderInfo:
    return ProviderInfo(name=name, version=VERSION, simulated=True, ml=False, note=note)


def _load_font(size: int):
    """Pillow's built-in bitmap font, scaled when the version supports it."""
    try:
        from PIL import ImageFont

        return ImageFont.load_default(size=size)
    except Exception:  # pragma: no cover - only on Pillow < 10.1
        return None


class MockBackgroundRemover:
    """Applies a synthetic elliptical mask and stamps the result as simulated.

    `item_count` controls how many ellipses are drawn, which is what makes the mock detector's
    single-versus-pair behaviour deterministic and predictable in tests.
    """

    def __init__(self, item_count: int = 1) -> None:
        self._item_count = max(1, min(3, item_count))
        self._n = 0

    @property
    def synthetic_item_count(self) -> int:
        """How many blobs this remover will draw, for `/health` and for tests.

        Exposed rather than inferred from `details` after a run, because an operator wants to know
        what the service *will* do before uploading anything.
        """
        return self._item_count

    def info(self) -> ProviderInfo:
        return _simulated(
            "mock-background-removal",
            "Simulated cutout. A synthetic mask was applied and the image is stamped SIMULATED.",
        )

    def remove(self, source: Image.Image) -> Outcome[CutoutResult]:
        info = self.info()
        rgba = source.convert("RGBA")
        width, height = rgba.size
        if width < 4 or height < 4:
            rgba = rgba.resize((max(8, width), max(8, height)), Image.NEAREST)
            width, height = rgba.size

        mask_image = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask_image)

        count = self._item_count
        top = height * 0.08
        bottom = height * 0.92
        if count == 1:
            draw.ellipse([width * 0.18, top, width * 0.82, bottom], fill=255)
        else:
            # Side-by-side blobs with a clear gap, so connected components genuinely separate
            # them — the mock should not bypass the real analysis it is standing in for.
            gap = width * 0.06
            each = (width * 0.88 - gap) / count
            left = width * 0.06
            for i in range(count):
                x0 = left + i * (each + gap)
                draw.ellipse([x0, top, x0 + each, bottom], fill=255)

        out = rgba.copy()
        out.putalpha(mask_image)

        overlay = ImageDraw.Draw(out)
        font = _load_font(max(11, int(width * 0.055)))
        text = WATERMARK
        try:
            box = overlay.textbbox((0, 0), text, font=font)
            text_w, text_h = box[2] - box[0], box[3] - box[1]
        except Exception:  # pragma: no cover
            text_w, text_h = len(text) * 7, 12
        pad = max(4, int(width * 0.012))
        x = max(2, (width - text_w) // 2)
        y = pad
        overlay.rectangle(
            [x - pad, y - pad, x + text_w + pad, y + text_h + pad],
            fill=(180, 24, 24, 210),
        )
        overlay.text((x, y), text, fill=(255, 255, 255, 255), font=font)

        mask = np.asarray(mask_image) > 127
        foreground_ratio = float(mask.mean())

        return Outcome.success(
            info,
            CutoutResult(
                image=out,
                mask=mask,
                foreground_ratio=foreground_ratio,
                source_had_alpha=False,
                details={
                    "method": "synthetic elliptical mask",
                    "simulated": True,
                    "watermark": WATERMARK,
                    "synthetic_item_count": count,
                    "quality_tier": "simulated",
                },
            ),
        )


class MockObjectDetector(BaselineObjectDetector):
    """Real connected-component analysis over a synthetic mask.

    Subclassed rather than reimplemented so the mock and baseline cannot drift apart — if the
    analysis changes, both change.
    """

    def info(self) -> ProviderInfo:
        return _simulated(
            "mock-connected-components",
            "Analysis is real, but it ran on a synthetic cutout. Not object recognition.",
        )


class MockModel3DGenerator:
    """Emits a genuine, valid GLB containing the cutout on a flat card.

    The file is real: it parses, has geometry and a texture, and the existing viewer will load it.
    What is absent is any 3D understanding — no depth was inferred, no backside exists, no
    measurement was taken. `simulated=True` records that, and the delivered metadata says so in
    words a seller can read.
    """

    def __init__(self, *, enabled: bool = False) -> None:
        self._enabled = enabled

    def info(self) -> ProviderInfo:
        if not self._enabled:
            return ProviderInfo(
                name="mock-billboard-3d",
                version=VERSION,
                simulated=True,
                ml=False,
                note="Disabled. 3D generation is switched off on this server.",
            )
        return _simulated(
            "mock-billboard-3d",
            "Placeholder flat card holding the cutout. No 3D reconstruction was performed.",
        )

    @property
    def available(self) -> bool:
        return self._enabled

    def generate(self, cutout: CutoutResult) -> Outcome[Model3DResult]:
        info = self.info()
        width, height = cutout.image.size
        aspect = (width / height) if height else 1.0

        buffer = io.BytesIO()
        cutout.image.save(buffer, format="PNG", optimize=False)
        png_bytes = buffer.getvalue()

        try:
            glb = build_textured_quad_glb(png_bytes, aspect=aspect, name="simulated-cutout")
        except Exception as exc:  # pragma: no cover - defensive
            from ..schemas import FailureCode

            return Outcome.error(
                info, FailureCode.THREE_D_FAILED, f"The placeholder model could not be built ({exc})."
            )

        return Outcome.success(
            info,
            Model3DResult(
                glb_bytes=glb,
                details={
                    "method": "flat textured quad",
                    "reconstruction": False,
                    "is_billboard": True,
                    "note": "Flat card, not a reconstruction. No depth was inferred.",
                },
            ),
        )
