"""Wire contract for the asset-processing API.

These models are the whole interface between the backend and the Vite frontend. Anything the
frontend needs to render a review screen must be in here; anything not in here is internal.

Honesty rules encoded in this file:
  * `ProviderInfo.simulated` and `.ml` are separate booleans. A deterministic algorithm that
    genuinely reads the image is `simulated=False, ml=False`. A canned result is
    `simulated=True`. Nothing in this service sets `ml=True` today.
  * A job whose 3D stage was skipped says so in the stage result — it is never silently absent.
  * `JobSummary.simulated` is true when ANY produced asset came from a simulated provider, so the
    review screen cannot accidentally show a fabricate result as if it were computed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------------------------


class JobState(str, Enum):
    """The observable pipeline states required by the spec.

    There is no state outside this enum: `failed` is terminal-but-retryable, and `rejected` is
    what a seller's "no" produces, so neither is represented by a missing field.
    """

    UPLOADED = "uploaded"
    QUEUED = "queued"
    VALIDATING = "validating"
    PREPROCESSING = "preprocessing"
    SEGMENTING = "segmenting"
    GENERATING_2D = "generating_2d"
    GENERATING_3D = "generating_3d"
    VALIDATING_ASSETS = "validating_assets"
    AWAITING_REVIEW = "awaiting_review"
    APPROVED = "approved"
    # Failure / terminal states
    FAILED = "failed"
    REJECTED = "rejected"


#: The happy-path order. `generating_3d` is included even when skipped so progress is stable.
STAGE_ORDER: tuple[str, ...] = (
    "validating",
    "preprocessing",
    "segmenting",
    "generating_2d",
    "generating_3d",
    "validating_assets",
)

#: States from which a retry is meaningful.
RETRYABLE_STATES = (JobState.FAILED,)


class StageState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class ItemConfiguration(str, Enum):
    """What the seller says is in the photo. `auto` asks the pipeline to decide."""

    SINGLE = "single"
    PAIR = "pair"
    MULTIPLE = "multiple"
    AUTO = "auto"


class DerivedAssetKind(str, Enum):
    CUTOUT_2D = "cutout_2d"
    MODEL_3D = "model_3d"


class AssetRole(str, Enum):
    """Where a derived asset belongs in the try-on engine.

    `left`/`right` exist because the earring solver places two independent anchors. `item_N` is a
    detected item whose side could not be established — the seller assigns meaning at review.
    """

    PRIMARY = "primary"
    LEFT = "left"
    RIGHT = "right"
    ITEM_1 = "item_1"
    ITEM_2 = "item_2"
    ITEM_3 = "item_3"


class FailureCode(str, Enum):
    """Machine-readable failure causes. Each maps to an actionable message in the API layer."""

    EMPTY_FILE = "empty_file"
    TOO_LARGE = "too_large"
    TOO_MANY_PIXELS = "too_many_pixels"
    UNSUPPORTED_TYPE = "unsupported_type"
    CORRUPT_IMAGE = "corrupt_image"
    UNSUPPORTED_MODE = "unsupported_mode"
    EMPTY_CUTOUT = "empty_cutout"
    LOW_FOREGROUND_RATIO = "low_foreground_ratio"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_ERROR = "provider_error"
    THREE_D_DISABLED = "three_d_disabled"
    THREE_D_FAILED = "three_d_failed"
    GLB_INVALID = "glb_invalid"
    UNKNOWN = "unknown"


# --------------------------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------------------------


class ProviderInfo(BaseModel):
    """Who produced a result, and what kind of thing they are.

    This is deliberately verbose. A UI that shows only "done" is how a simulated result gets
    mistaken for a real one.
    """

    name: str
    version: str
    #: True when the output was NOT computed from the seller's image.
    simulated: bool
    #: True when a trained model produced the output. Always False in this milestone.
    ml: bool
    #: One sentence, safe to show a seller. Never contains model names or configuration.
    note: str


# --------------------------------------------------------------------------------------------
# Stages
# --------------------------------------------------------------------------------------------


class StageResult(BaseModel):
    stage: str
    state: StageState = StageState.PENDING
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    message: str | None = None
    provider: ProviderInfo | None = None
    details: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------------------------


class DerivedAsset(BaseModel):
    id: str
    kind: DerivedAssetKind
    role: AssetRole
    #: Path relative to the service root, e.g. `assets/<job>/cutout-left.png`.
    path: str
    #: Absolute URL the browser can fetch. Built from ASSET_PUBLIC_BASE_URL.
    url: str
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    #: True when the pixels were synthesised rather than derived from the upload.
    simulated: bool = False
    provider: ProviderInfo | None = None
    approved: bool = False
    #: Free-form, non-authoritative observations (padding applied, bounding box, ...).
    details: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------------------------
# Input echo
# --------------------------------------------------------------------------------------------


class InputSummary(BaseModel):
    file_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    width: int | None = None
    height: int | None = None
    mode: str | None = None
    #: Relative path of the preserved original. The original is never overwritten.
    original_path: str


class ProductDraft(BaseModel):
    """The product fields the seller supplied alongside the image.

    This service does NOT create products. It returns these back so the frontend keeps owning
    product creation, as it does today.
    """

    name: str | None = None
    category: str | None = None
    item_configuration: ItemConfiguration = ItemConfiguration.AUTO
    anchor: str | None = None
    #: Index into the uploaded files that the seller nominated as primary, if several were sent.
    primary_index: int = 0


# --------------------------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------------------------


class DetectedItem(BaseModel):
    index: int
    #: Bounding box in the source image's pixel space: [left, top, right, bottom].
    bbox: tuple[int, int, int, int]
    area_ratio: float
    centroid: tuple[float, float]
    #: Fraction of the whole cutout this item represents.
    confidence: float
    suggested_role: AssetRole


class DetectionSummary(BaseModel):
    item_count: int
    #: What the pipeline concluded, which may differ from the seller's answer.
    resolved_configuration: ItemConfiguration
    #: True when the seller and the pipeline disagree, or confidence is low — the UI must ask.
    needs_seller_confirmation: bool
    confidence: float
    items: list[DetectedItem] = Field(default_factory=list)
    provider: ProviderInfo | None = None
    explanation: str


# --------------------------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------------------------


class JobError(BaseModel):
    code: FailureCode
    stage: str
    #: Shown to the seller. Written as advice, not as a stack trace.
    message: str
    #: Retrying the same input may plausibly succeed.
    retryable: bool
    detail: str | None = None


# --------------------------------------------------------------------------------------------
# Job
# --------------------------------------------------------------------------------------------


class ProcessingOptions(BaseModel):
    remove_background: bool = True
    generate_3d: bool = False
    output_long_edge: int | None = None


class JobCreateResponse(BaseModel):
    id: str
    state: JobState
    status_url: str
    created_at: datetime


class JobSummary(BaseModel):
    """The polling payload. Cheap to serialise and complete enough to render progress."""

    id: str
    state: JobState
    created_at: datetime
    updated_at: datetime
    product: ProductDraft
    input: InputSummary | None = None
    stages: list[StageResult] = Field(default_factory=list)
    detection: DetectionSummary | None = None
    assets: list[DerivedAsset] = Field(default_factory=list)
    error: JobError | None = None
    #: True when ANY asset or stage output was simulated rather than computed.
    simulated: bool = False
    #: 0.0–1.0, derived from stage completion. Progress is reported, never estimated.
    progress: float = 0.0
    options: ProcessingOptions = Field(default_factory=ProcessingOptions)
    approved_at: datetime | None = None
    attempts: int = 0
    #: Plain-language list the review screen must show verbatim. See review_notes().
    notes: list[str] = Field(default_factory=list)


class ApproveRequest(BaseModel):
    """Seller approval. `roles` lets the review screen correct the automatic assignment."""

    asset_ids: list[str] | None = None
    #: Optional correction of the single/pair decision made at detection time.
    confirmed_configuration: ItemConfiguration | None = None
    #: Optional reassignment of an asset to a different role, keyed by asset id.
    roles: dict[str, AssetRole] | None = None


class RejectRequest(BaseModel):
    reason: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    provider: str
    enable_3d: bool
    #: Names of the provider implementations actually in use, for an operator to eyeball.
    providers: dict[str, str]
    data_dir_writable: bool
