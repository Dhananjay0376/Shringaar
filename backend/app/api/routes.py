"""HTTP surface.

Ten endpoints, all of them thin: parse and validate the request, hand it to the pipeline, serialise
the result. No image logic lives here.

**Authentication is not implemented in this milestone.** Every job is reachable by whoever knows its
id, and ids are random but not secret. That is acceptable only because the service is meant to run
on a developer's own machine; the README says so, and serving it on a public interface would be a
mistake. The spec's ownership rules ("a user must not be able to access or approve another seller's
assets") are enforced by Supabase RLS in the next milestone, when jobs move into a table — an
in-memory store has no owner column and no session to check against, so pretending to enforce it
here would be security theatre.
"""

from __future__ import annotations

import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse

from ..config import settings
from ..jobs import (
    InvalidTransition,
    JobNotFound,
    JobRecord,
    apply_approval,
    apply_rejection,
    require_retryable,
    store,
)
from ..pipeline import run_job
from ..providers import ProviderSet
from ..schemas import (
    ApproveRequest,
    HealthResponse,
    ItemConfiguration,
    JobCreateResponse,
    JobState,
    JobSummary,
    ProductDraft,
    RejectRequest,
)
from ..storage import (
    StorageError,
    data_dir_writable,
    exists,
    purge_job,
    resolve_public,
    write_bytes,
)

router = APIRouter()
files_router = APIRouter()

#: The upload is read in chunks so a 2 GB request cannot be buffered into memory before the size
#: check. The declared Content-Length is not trusted either.
CHUNK = 1024 * 1024


def get_providers(request: Request) -> ProviderSet:
    """The provider set for this process, chosen once at startup from ASSET_PROVIDER."""
    return request.app.state.providers


Providers = Annotated[ProviderSet, Depends(get_providers)]


def _record(job_id: str) -> JobRecord:
    try:
        return store.get(job_id)
    except JobNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No job with id '{job_id}'.") from None


async def _read_capped(upload: UploadFile, cap: int) -> bytes:
    """Read an upload up to `cap` bytes, refusing anything larger without buffering it all."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > cap:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"This image is larger than the {cap // (1024 * 1024)} MB limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _parse_configuration(raw: str | None) -> ItemConfiguration:
    if raw is None or not raw.strip():
        return ItemConfiguration.AUTO
    try:
        return ItemConfiguration(raw.strip().lower())
    except ValueError:
        allowed = ", ".join(c.value for c in ItemConfiguration)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"item_configuration must be one of: {allowed}.",
        ) from None


def _parse_bool(raw: str | None, *, default: bool) -> bool:
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@router.get("/health", response_model=HealthResponse, tags=["ops"])
def health(providers: Providers) -> HealthResponse:
    """What this service is, and which providers are actually live.

    The provider names are for an operator, not for a seller — the spec is explicit that internal
    model configuration is never exposed to the storefront.
    """
    from .. import __version__

    return HealthResponse(
        status="ok",
        version=__version__,
        provider=providers.name,
        enable_3d=settings.enable_3d,
        providers=providers.describe(),
        data_dir_writable=data_dir_writable(),
    )


@router.post(
    "/api/jobs",
    response_model=JobCreateResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["jobs"],
)
async def create_job(
    providers: Providers,
    file: Annotated[UploadFile, File(description="One product photograph.")],
    name: Annotated[str | None, Form()] = None,
    category: Annotated[str | None, Form()] = None,
    item_configuration: Annotated[str | None, Form()] = None,
    anchor: Annotated[str | None, Form()] = None,
    generate_3d: Annotated[str | None, Form()] = None,
    output_long_edge: Annotated[int | None, Form()] = None,
) -> JobCreateResponse:
    """Accept an upload and start processing it.

    The bytes are preserved verbatim before anything looks at them, so a failed decode still leaves
    the seller's original intact and a retry re-processes exactly what was sent.
    """
    configuration = _parse_configuration(item_configuration)

    if output_long_edge is not None and not (64 <= output_long_edge <= 4096):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "output_long_edge must be between 64 and 4096."
        )

    data = await _read_capped(file, settings.max_upload_bytes)
    if not data:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No file was received. Choose an image and try again.",
        )

    record = store.add(JobRecord(id=store.new_id()))
    record.source_file_name = (file.filename or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    record.product = ProductDraft(
        name=(name or "").strip() or None,
        category=(category or "").strip() or None,
        item_configuration=configuration,
        anchor=(anchor or "").strip() or None,
    )
    record.options.generate_3d = _parse_bool(generate_3d, default=settings.enable_3d)
    if output_long_edge is not None:
        record.options.output_long_edge = output_long_edge

    # Stored under an extension-neutral name on purpose: the client's filename is not evidence of
    # the format, and the pipeline decides the format from the bytes.
    stored = write_bytes(record.id, kind="uploads", filename="source.upload", data=data)
    record.original_rel_path = stored.rel_path
    record.set_state(JobState.QUEUED)

    store.executor.submit(run_job, record.id, providers)

    return JobCreateResponse(
        id=record.id,
        state=record.state,
        status_url=f"/api/jobs/{record.id}",
        created_at=record.created_at,
    )


@router.get("/api/jobs", response_model=list[JobSummary], tags=["jobs"])
def list_jobs(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[JobSummary]:
    return [record.summary() for record in store.all(limit=limit)]


@router.get("/api/jobs/{job_id}", response_model=JobSummary, tags=["jobs"])
def get_job(job_id: str) -> JobSummary:
    """The polling endpoint. Cheap enough to call every second."""
    return _record(job_id).summary()


@router.post("/api/jobs/{job_id}/approve", response_model=JobSummary, tags=["review"])
def approve_job(job_id: str, request: ApproveRequest) -> JobSummary:
    """Record a seller's approval of specific assets.

    This is the gate the spec requires: a generated asset is not usable for try-on until a human has
    looked at it and said yes.
    """
    record = _record(job_id)
    try:
        apply_approval(record, request)
    except InvalidTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    return record.summary()


@router.post("/api/jobs/{job_id}/reject", response_model=JobSummary, tags=["review"])
def reject_job(job_id: str, request: RejectRequest) -> JobSummary:
    record = _record(job_id)
    try:
        apply_rejection(record, request.reason)
    except InvalidTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    return record.summary()


@router.post("/api/jobs/{job_id}/retry", response_model=JobSummary, tags=["jobs"])
def retry_job(job_id: str, providers: Providers) -> JobSummary:
    """Re-run a failed job against the preserved original upload.

    Only `failed` is retryable. A job that already produced assets is not re-run here: that would
    silently discard output the seller may have been reviewing.
    """
    record = _record(job_id)
    try:
        require_retryable(record)
    except InvalidTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    # Checked on disk, not just on the field: the path can still be recorded after an operator or a
    # cleanup job has removed the file, and re-running against a missing original would fail with a
    # confusing internal error instead of this sentence.
    if record.original_rel_path is None or not exists(record.original_rel_path):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This job's original upload is no longer available."
        )

    record.reset_for_retry()
    store.executor.submit(run_job, record.id, providers)
    return record.summary()


@router.delete("/api/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["ops"])
def delete_job(job_id: str) -> None:
    """Drop a job and its files. Used by tests and by an operator, never by the storefront."""
    record = _record(job_id)
    purge_job(record.id)
    store.remove(job_id)


@files_router.get("/files/{path:path}", tags=["files"], response_class=FileResponse)
def serve_file(path: str) -> FileResponse:
    """Serve a stored asset.

    The path is resolved and containment-checked by storage.resolve_public, which refuses traversal
    and anything outside the data directory — so this is not a way to read arbitrary files.
    """
    try:
        target = resolve_public(path)
    except StorageError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None

    media_type = mimetypes.guess_type(target.name)[0]
    if media_type is None:
        media_type = "application/octet-stream"
    return FileResponse(target, media_type=media_type)
