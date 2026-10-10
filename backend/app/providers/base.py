"""Provider interfaces.

Every expensive or model-shaped step sits behind one of these protocols. That is what makes the
real providers (a U²-Net matting model, an ONNX segmenter, TripoSR) a drop-in replacement later
without touching the pipeline, the API, or the frontend.

Three things are deliberate here:

* **`Outcome` is the only return shape.** A provider cannot signal failure by returning `None` or
  by raising into the pipeline — it returns a coded failure with a message a seller can act on.
  That is what keeps "the cutout was empty" distinguishable from "the provider crashed".
* **`ProviderInfo` travels with every result**, so provenance is never reconstructed after the
  fact from which provider was configured at the time.
* **No provider decides policy.** Whether a failed 3D stage blocks the job is the orchestrator's
  decision, not the provider's.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Protocol, TypeVar, runtime_checkable

import numpy as np
from PIL import Image

from ..schemas import FailureCode, ProviderInfo

T = TypeVar("T")


@dataclass
class Outcome(Generic[T]):
    """Success or a coded failure. Never both, never neither."""

    ok: bool
    info: ProviderInfo
    value: T | None = None
    failure: FailureCode | None = None
    message: str | None = None

    @classmethod
    def success(cls, info: ProviderInfo, value: T) -> "Outcome[T]":
        return cls(ok=True, info=info, value=value)

    @classmethod
    def error(
        cls, info: ProviderInfo, failure: FailureCode, message: str
    ) -> "Outcome[T]":
        return cls(ok=False, info=info, failure=failure, message=message)


@dataclass
class CutoutResult:
    """A transparent RGBA cutout plus the mask it came from."""

    image: Image.Image
    #: Boolean foreground mask at the cutout's own resolution.
    mask: np.ndarray
    #: Fraction of pixels considered foreground. Used to catch a near-empty cutout.
    foreground_ratio: float
    #: True when the uploaded file already carried usable transparency, in which case the
    #: existing alpha was honoured rather than discarded and re-derived.
    source_had_alpha: bool
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class DetectedItemBox:
    """One candidate jewellery item, in the coordinate space of the image it was found in."""

    bbox: tuple[int, int, int, int]
    area: int
    centroid: tuple[float, float]
    #: This item's area as a fraction of the largest item's area. Near 1.0 for a matched pair.
    relative_size: float


@dataclass
class DetectionOutcome:
    items: list[DetectedItemBox]
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class Model3DResult:
    glb_bytes: bytes
    details: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class BackgroundRemover(Protocol):
    def info(self) -> ProviderInfo: ...

    def remove(self, source: Image.Image) -> Outcome[CutoutResult]: ...


@runtime_checkable
class ObjectDetector(Protocol):
    def info(self) -> ProviderInfo: ...

    def detect(self, cutout: CutoutResult) -> Outcome[DetectionOutcome]: ...


@runtime_checkable
class Model3DGenerator(Protocol):
    def info(self) -> ProviderInfo: ...

    @property
    def available(self) -> bool:
        """False when this provider cannot run in the current environment.

        A provider that is not available must say so rather than return a fabricated model.
        """
        ...

    def generate(self, cutout: CutoutResult) -> Outcome[Model3DResult]: ...
