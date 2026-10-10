"""Synthetic product photographs for tests.

Real jewellery photographs do not belong in a repository, and the ones the prompt referred to
("the supplied green-and-gold jhumka pair") are not present in it — a check of the repository root
finds only design references (`ref-hero.png`, `ref-features.png`, `ref-footer.png`), no product
photograph. So the fixtures here are generated, deterministic and obviously synthetic.

They are not trying to look like jewellery. They are trying to exercise the *structure* the pipeline
must handle: a subject that contrasts with its background (so segmentation has something to find),
predictable item counts (so single/pair/multiple can be asserted), and clean separation between
items (so connected-component analysis genuinely has to split them).
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

#: A flat studio-grey background. Flat matters: the baseline remover estimates the background from
#: the border, so a gradient here would make the test measure the estimator instead of the subject.
BACKGROUND = (238, 236, 232)
GOLD = (198, 152, 62)
DARK = (46, 40, 34)


def _canvas(width: int, height: int) -> Image.Image:
    return Image.new("RGB", (width, height), BACKGROUND)


def _ellipse(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    fill: tuple[int, int, int] = GOLD,
) -> None:
    draw.ellipse(box, fill=fill)


def single_item(width: int = 400, height: int = 400) -> Image.Image:
    """One centred item — the simplest thing a seller uploads."""
    image = _canvas(width, height)
    draw = ImageDraw.Draw(image)
    cx, cy = width // 2, height // 2
    _ellipse(draw, (cx - 70, cy - 90, cx + 70, cy + 90))
    _ellipse(draw, (cx - 24, cy - 130, cx + 24, cy - 70))
    return image


def paired_items(width: int = 520, height: int = 360) -> Image.Image:
    """Two similar items with a clear gap between them — the pair case.

    The gap is the point: if the two shapes touched, they would be one connected component and the
    detector would correctly report a single item. A "pair" test needs them genuinely separate.
    """
    image = _canvas(width, height)
    draw = ImageDraw.Draw(image)
    cy = height // 2
    _ellipse(draw, (70, cy - 80, 190, cy + 80))
    _ellipse(draw, (92, cy - 118, 168, cy - 62))
    _ellipse(draw, (330, cy - 80, 450, cy + 80))
    _ellipse(draw, (352, cy - 118, 428, cy - 62))
    return image


def three_items(width: int = 640, height: int = 320) -> Image.Image:
    """Three separated items — the "too many to assume" case."""
    image = _canvas(width, height)
    draw = ImageDraw.Draw(image)
    cy = height // 2
    for left in (60, 260, 460):
        _ellipse(draw, (left, cy - 70, left + 120, cy + 70))
    return image


def asymmetric_pair(width: int = 520, height: int = 360) -> Image.Image:
    """Two items whose sizes differ enough that they should not be called a matched pair."""
    image = _canvas(width, height)
    draw = ImageDraw.Draw(image)
    cy = height // 2
    _ellipse(draw, (60, cy - 90, 200, cy + 90))
    _ellipse(draw, (350, cy - 40, 430, cy + 40))
    return image


def flat_colour(width: int = 320, height: int = 240) -> Image.Image:
    """A uniform image with nothing in it. Segmentation must report an empty cutout."""
    return _canvas(width, height)


def already_transparent(width: int = 300, height: int = 300) -> Image.Image:
    """An RGBA PNG that already carries usable transparency.

    Exercises the "honour existing alpha" path rather than discarding it and re-deriving a mask.
    """
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cx, cy = width // 2, height // 2
    draw.ellipse((cx - 60, cy - 70, cx + 60, cy + 70), fill=(*GOLD, 255))
    return image


def encode(image: Image.Image, fmt: str = "PNG", **kwargs) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def png(image: Image.Image) -> bytes:
    return encode(image, "PNG")


def jpeg(image: Image.Image) -> bytes:
    # Quality 95 keeps the item edges crisp; the baseline threshold is measured on colour distance,
    # and heavy JPEG ringing around a hard edge is a real complication that is not what these tests
    # are about.
    return encode(image, "JPEG", quality=95)


def webp(image: Image.Image) -> bytes:
    return encode(image, "WEBP", quality=95, method=4)


def truncated_png(image: Image.Image) -> bytes:
    """A PNG whose data stream is cut short — the classic partial-download case."""
    data = png(image)
    return data[: len(data) // 2]


def not_an_image() -> bytes:
    return b"<html><body>404 Not Found</body></html>" + b" " * 64


__all__ = [
    "already_transparent",
    "asymmetric_pair",
    "flat_colour",
    "jpeg",
    "not_an_image",
    "paired_items",
    "png",
    "single_item",
    "three_items",
    "truncated_png",
    "webp",
]
