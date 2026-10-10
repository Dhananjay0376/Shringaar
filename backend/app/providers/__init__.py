"""Provider selection.

One place decides which implementations the pipeline uses. Adding a real background-removal model
later means adding a module and one branch here — nothing else in the service changes.

The provider set is chosen from `ASSET_PROVIDER`, and `/health` reports which one is live, so
"which providers am I actually running" is never a guess.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import Settings
from . import baseline, mock
from .base import BackgroundRemover, Model3DGenerator, ObjectDetector

#: Recognised values of ASSET_PROVIDER.
KNOWN_PROVIDERS = ("baseline", "mock")


@dataclass(frozen=True)
class ProviderSet:
    name: str
    background: BackgroundRemover
    detector: ObjectDetector
    model3d: Model3DGenerator

    def describe(self) -> dict[str, str]:
        """Which implementations are configured, and which of them can actually run.

        Availability is reported next to the name rather than left implicit. A provider that is
        configured but disabled — the 3D generator when `ASSET_ENABLE_3D` is false — would otherwise
        be named here as though it were live, and an operator reading `/health` would conclude that
        3D generation is happening when the pipeline is skipping it.
        """
        return {
            "set": self.name,
            "background": self.background.info().name,
            "detection": self.detector.info().name,
            "model_3d": self.model3d.info().name,
            "model_3d_available": "yes" if self.model3d.available else "no",
            # How many blobs the background provider draws, when it draws them at all. That count
            # decides which branch of the review flow a run exercises, and without it there is no
            # way to tell a single-item run from a pair run by looking at the service.
            **(
                {"background_items": str(self.background.synthetic_item_count)}
                if hasattr(self.background, "synthetic_item_count")
                else {}
            ),
        }


def build_providers(settings: Settings) -> ProviderSet:
    """Construct the provider set for this process.

    An unrecognised ASSET_PROVIDER falls back to `baseline` rather than failing to start: a typo in
    an environment variable should not take the service down, and `/health` makes the effective
    choice visible.
    """
    if settings.provider == "mock":
        return ProviderSet(
            name="mock",
            background=mock.MockBackgroundRemover(item_count=settings.mock_item_count),
            detector=mock.MockObjectDetector(),
            model3d=mock.MockModel3DGenerator(enabled=settings.enable_3d),
        )
    return ProviderSet(
        name="baseline",
        background=baseline.BaselineBackgroundRemover(),
        detector=baseline.BaselineObjectDetector(),
        model3d=baseline.BaselineModel3DGenerator(),
    )


__all__ = ["ProviderSet", "build_providers", "KNOWN_PROVIDERS"]
