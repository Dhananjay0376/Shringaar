"""In-memory job store.

**This is deliberately not a database.** The add-on scopes this milestone to a mock-backed workflow
with local storage; a job table in Supabase is the next milestone, and the API surface here is
already the shape that table would serve.

Two consequences of in-memory state, stated rather than hidden:
  * **Jobs do not survive a restart.** A job in flight when the process stops is gone.
  * **Jobs are per-process.** Running two workers behind a load balancer would split the job list.
  Both are acceptable for a single-process local service and neither is acceptable in production,
  which is exactly why the store is isolated behind this module.

Concurrency is bounded by `MAX_CONCURRENT_JOBS`. Heavy inference must not be allowed to arrive
unbounded — that is a resource-limit requirement, not a nicety.
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .schemas import (
    STAGE_ORDER,
    ApproveRequest,
    DerivedAsset,
    DetectionSummary,
    ItemConfiguration,
    JobError,
    JobState,
    JobSummary,
    ProcessingOptions,
    ProductDraft,
    InputSummary,
    RETRYABLE_STATES,
    StageResult,
    StageState,
    utcnow,
)

#: Uploads are processed on a small pool. Image work is CPU-bound, so this is a throughput cap as
#: much as a safety one: more workers would not make it faster, only noisier.
MAX_CONCURRENT_JOBS = 2

#: How many uploads one job may carry.
MAX_FILES_PER_JOB = 6


class JobNotFound(KeyError):
    pass


class InvalidTransition(RuntimeError):
    pass


@dataclass
class JobRecord:
    id: str
    state: JobState = JobState.UPLOADED
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    product: ProductDraft = field(default_factory=ProductDraft)
    options: ProcessingOptions = field(default_factory=ProcessingOptions)
    input: InputSummary | None = None
    stages: dict[str, StageResult] = field(default_factory=dict)
    detection: DetectionSummary | None = None
    assets: list[DerivedAsset] = field(default_factory=list)
    error: JobError | None = None
    approved_at: datetime | None = None
    attempts: int = 0
    original_rel_path: str | None = None
    #: The seller's own filename, echoed back for display. Never used to decide the format.
    source_file_name: str = "upload"
    notes: list[str] = field(default_factory=list)
    #: Extra uploads beyond the primary, kept for a future multi-view flow. Paths only.
    extra_inputs: list[InputSummary] = field(default_factory=list)
    rejection_reason: str | None = None

    def __post_init__(self) -> None:
        for stage in STAGE_ORDER:
            self.stages.setdefault(stage, StageResult(stage=stage))
        if not self.product.name:
            self.product = ProductDraft(
                category=self.product.category,
                item_configuration=self.product.item_configuration,
                anchor=self.product.anchor,
                primary_index=self.product.primary_index,
            )

    # -- transitions -------------------------------------------------------------------------

    def set_state(self, state: JobState) -> None:
        self.state = state
        self.updated_at = utcnow()

    def open_stage(self, stage: str) -> StageResult:
        result = self.stages[stage]
        result.state = StageState.RUNNING
        result.started_at = utcnow()
        self.set_state(JobState(stage))
        return result

    def close_stage(
        self,
        stage: str,
        *,
        state: StageState,
        message: str | None = None,
        provider: Any = None,
        details: dict[str, Any] | None = None,
    ) -> StageResult:
        result = self.stages[stage]
        result.state = state
        result.finished_at = utcnow()
        if result.started_at is not None:
            result.duration_ms = int(
                (result.finished_at - result.started_at).total_seconds() * 1000
            )
        result.message = message
        if provider is not None:
            result.provider = provider
        if details:
            result.details.update(details)
        self.updated_at = utcnow()
        return result

    @property
    def simulated(self) -> bool:
        if any(asset.simulated for asset in self.assets):
            return True
        return any(
            stage.provider is not None and stage.provider.simulated
            for stage in self.stages.values()
        )
    # -- derived -----------------------------------------------------------------------------

    @property
    def long_edge(self) -> int:
        """The output size for this job, falling back to the service default."""
        from .config import settings

        return self.options.output_long_edge or settings.output_long_edge

    @property
    def progress(self) -> float:
        settled = sum(
            1
            for stage in self.stages.values()
            if stage.state in (StageState.SUCCEEDED, StageState.SKIPPED, StageState.FAILED)
        )
        return round(settled / len(STAGE_ORDER), 4)

    def reset_for_retry(self) -> None:
        """Clear everything a previous attempt produced, so a retry cannot inherit stale assets.

        The original upload and the input echo are kept on purpose: a retry re-processes the same
        file, which is the only thing "retry" can honestly mean. Everything derived is discarded.
        """
        self.assets = []
        self.detection = None
        self.error = None
        self.notes = []
        self.approved_at = None
        self.rejection_reason = None
        for stage in STAGE_ORDER:
            self.stages[stage] = StageResult(stage=stage)
        self.set_state(JobState.QUEUED)

    def summary(self) -> JobSummary:
        return JobSummary(
            id=self.id,
            state=self.state,
            created_at=self.created_at,
            updated_at=self.updated_at,
            product=self.product,
            input=self.input,
            stages=[self.stages[name] for name in STAGE_ORDER],
            detection=self.detection,
            assets=list(self.assets),
            error=self.error,
            simulated=self.simulated,
            progress=self.progress,
            options=self.options,
            approved_at=self.approved_at,
            attempts=self.attempts,
            notes=list(self.notes),
        )


class JobStore:
    def __init__(self, max_workers: int = MAX_CONCURRENT_JOBS) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.RLock()
        self._max_workers = max_workers
        self._executor: ThreadPoolExecutor | None = None

    @property
    def executor(self) -> ThreadPoolExecutor:
        """The worker pool, created on first use and recreated after a shutdown.

        Built lazily rather than in the constructor because a process can start the app more than
        once — a test session, a dev reload — and a pool that was shut down once must not leave the
        second app unable to submit anything.
        """
        with self._lock:
            if self._executor is None:
                self._executor = ThreadPoolExecutor(
                    max_workers=self._max_workers, thread_name_prefix="asset-job"
                )
            return self._executor

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def add(self, record: JobRecord) -> JobRecord:
        with self._lock:
            self._jobs[record.id] = record
        return record

    def get(self, job_id: str) -> JobRecord:
        with self._lock:
            record = self._jobs.get(job_id)
        if record is None:
            raise JobNotFound(job_id)
        return record

    def has(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._jobs

    def all(self, *, limit: int = 50) -> list[JobRecord]:
        with self._lock:
            records = list(self._jobs.values())
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records[:limit]

    def clear(self) -> None:
        """Test helper. Not exposed over HTTP."""
        with self._lock:
            self._jobs.clear()

    def remove(self, job_id: str) -> None:
        """Drop a job from the store. Its files are the caller's responsibility."""
        with self._lock:
            self._jobs.pop(job_id, None)

    def shutdown(self) -> None:
        """Stop the worker pool. Idempotent, and the pool comes back on next use."""
        with self._lock:
            if self._executor is not None:
                self._executor.shutdown(wait=False, cancel_futures=True)
                self._executor = None


#: Process-wide store. One instance, so the executor is one pool.
store = JobStore()


def require_retryable(record: JobRecord) -> None:
    """Refuse a retry that the job itself has already said would be pointless.

    The state gate is the coarse one; the finer one is `error.retryable`, which the pipeline sets
    from the *reason* it failed. A file that is not an image, or is empty, fails identically on
    every attempt — offering a retry there would produce a button that always fails, so the API
    refuses it with the actual reason instead.
    """
    if record.state not in RETRYABLE_STATES:
        raise InvalidTransition(
            f"A job in state '{record.state.value}' cannot be retried; only "
            f"{', '.join(s.value for s in RETRYABLE_STATES)} can."
        )
    if record.error is not None and not record.error.retryable:
        raise InvalidTransition(
            f"This job failed for a reason that re-running would not change "
            f"({record.error.code.value}). Upload a different image instead."
        )


def apply_approval(record: JobRecord, request: ApproveRequest) -> JobRecord:
    """Mark the seller's chosen assets approved and the job settled.

    Approval is the gate before a generated asset may be published — an unapproved asset is not
    usable by the storefront, and the API refuses to approve a job that has no assets.
    """
    if not record.assets:
        raise InvalidTransition("This job has no assets to approve.")
    if record.state == JobState.APPROVED:
        raise InvalidTransition("This job has already been approved.")
    if record.state not in (JobState.AWAITING_REVIEW,):
        raise InvalidTransition(
            f"Assets can only be approved once processing has finished "
            f"(this job is '{record.state.value}')."
        )

    wanted = set(request.asset_ids) if request.asset_ids else {a.id for a in record.assets}
    known = {a.id for a in record.assets}
    unknown = wanted - known
    if unknown:
        raise InvalidTransition(f"Unknown asset id(s): {', '.join(sorted(unknown))}")

    if request.roles:
        for asset_id, role in request.roles.items():
            for asset in record.assets:
                if asset.id == asset_id:
                    asset.role = role

    for asset in record.assets:
        asset.approved = asset.id in wanted

    if request.confirmed_configuration and record.detection is not None:
        record.detection.resolved_configuration = request.confirmed_configuration
        record.detection.needs_seller_confirmation = False

    record.set_state(JobState.APPROVED)
    record.approved_at = utcnow()
    record.notes = [
        note
        for note in record.notes
        if "confirm" not in note.lower() and "check" not in note.lower()
    ]
    return record


def apply_rejection(record: JobRecord, reason: str | None) -> JobRecord:
    if record.state not in (JobState.AWAITING_REVIEW, JobState.APPROVED):
        raise InvalidTransition(
            f"Only a job awaiting review can be rejected (this job is '{record.state.value}')."
        )
    record.set_state(JobState.REJECTED)
    record.rejection_reason = reason
    for asset in record.assets:
        asset.approved = False
    return record


__all__ = [
    "JobRecord",
    "JobStore",
    "JobNotFound",
    "InvalidTransition",
    "MAX_FILES_PER_JOB",
    "apply_approval",
    "apply_rejection",
    "require_retryable",
    "store",
]
