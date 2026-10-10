"""Stage A — image validation.

Validates what the file *is*, not what it claims to be. A `.png` extension and a declared
`Content-Type: image/png` are both attacker-controlled; the decoded image is not. So the format
decision is made by Pillow from the byte stream and the filename is only ever echoed back for
display.

Order matters here: dimensions are read from the header **before** the pixels are decoded, so a
decompression bomb is rejected on its declared size rather than after it has consumed memory.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from ...providers.base import Outcome
from ...schemas import FailureCode, ProviderInfo

VERSION = "0.1.0"

#: Decoded formats this service accepts, mapped to the MIME type it will report.
FORMAT_TO_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}

#: EXIF tag number for Orientation. Named rather than imported so the module does not depend on
#: `PIL.ExifTags` internals that have moved between Pillow versions.
EXIF_ORIENTATION_TAG = 274


def stage_info() -> ProviderInfo:
    return ProviderInfo(
        name="pillow-decode",
        version=VERSION,
        simulated=False,
        ml=False,
        note="File format and integrity are checked from the decoded bytes, not the filename.",
    )


@dataclass
class DecodedImage:
    image: Image.Image
    mime_type: str
    format: str
    width: int
    height: int
    sha256: str
    size_bytes: int
    details: dict[str, Any] = field(default_factory=dict)


def decode_upload(
    data: bytes,
    *,
    max_bytes: int,
    max_pixels: int,
) -> Outcome[DecodedImage]:
    """Decode and validate an uploaded image, or explain precisely why it was rejected."""
    info = stage_info()

    if not data:
        return Outcome.error(info, FailureCode.EMPTY_FILE, "The uploaded file was empty.")

    if len(data) > max_bytes:
        return Outcome.error(
            info,
            FailureCode.TOO_LARGE,
            f"This image is {len(data) / (1024 * 1024):.1f} MB. The limit is "
            f"{max_bytes / (1024 * 1024):.0f} MB — try exporting it at a smaller size.",
        )

    digest = hashlib.sha256(data).hexdigest()

    try:
        probe = Image.open(io.BytesIO(data))
        declared_format = (probe.format or "").upper()
        declared_size = probe.size
    except UnidentifiedImageError:
        return Outcome.error(
            info,
            FailureCode.UNSUPPORTED_TYPE,
            "This file is not an image this service can read. PNG, JPEG and WebP are supported.",
        )
    except Image.DecompressionBombError:
        return Outcome.error(
            info,
            FailureCode.TOO_MANY_PIXELS,
            "This image is too large to process safely. Try a smaller export.",
        )
    except Exception as exc:
        return Outcome.error(
            info, FailureCode.CORRUPT_IMAGE, f"This image could not be opened ({exc})."
        )

    if declared_format not in FORMAT_TO_MIME:
        pretty = declared_format or "an unknown format"
        return Outcome.error(
            info,
            FailureCode.UNSUPPORTED_TYPE,
            f"{pretty} images are not supported. Save the product as PNG, JPEG or WebP.",
        )

    width, height = declared_size
    if width <= 0 or height <= 0:
        return Outcome.error(info, FailureCode.CORRUPT_IMAGE, "This image has no pixels.")

    # Checked from the header, before decode. This is the decompression-bomb guard.
    if width * height > max_pixels:
        return Outcome.error(
            info,
            FailureCode.TOO_MANY_PIXELS,
            f"This image is {width}×{height} ({width * height / 1_000_000:.0f} megapixels). The "
            f"limit is {max_pixels / 1_000_000:.0f} megapixels.",
        )

    try:
        probe.load()
    except Image.DecompressionBombError:
        return Outcome.error(
            info,
            FailureCode.TOO_MANY_PIXELS,
            "This image is too large to process safely. Try a smaller export.",
        )
    except Exception as exc:
        return Outcome.error(
            info,
            FailureCode.CORRUPT_IMAGE,
            f"This image is truncated or damaged and could not be fully decoded ({exc}).",
        )

    # A rotated phone photo would otherwise reach the solver sideways, which reads as an anchor
    # bug rather than an orientation one.
    #
    # The flag is read from the EXIF tag rather than from object identity: `exif_transpose` returns
    # a *copy* even when there is nothing to transpose, so `image is not probe` is always true and
    # would report every image as rotated.
    orientation = _declared_orientation(probe)
    image = ImageOps.exif_transpose(probe)

    return Outcome.success(
        info,
        DecodedImage(
            image=image,
            mime_type=FORMAT_TO_MIME[declared_format],
            format=declared_format,
            width=image.width,
            height=image.height,
            sha256=digest,
            size_bytes=len(data),
            details={
                "declared_format": declared_format,
                "original_mode": probe.mode,
                "orientation_normalised": orientation not in (None, 1),
                "declared_orientation": orientation,
                "pixels": image.width * image.height,
            },
        ),
    )


def _declared_orientation(image: Image.Image) -> int | None:
    """The EXIF orientation tag, if the format carries one and it can be read."""
    try:
        value = image.getexif().get(EXIF_ORIENTATION_TAG)
    except Exception:  # noqa: BLE001 - a malformed EXIF block must not fail the upload
        return None
    return value if isinstance(value, int) else None
