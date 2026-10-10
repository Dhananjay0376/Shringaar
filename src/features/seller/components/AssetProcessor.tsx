import { useEffect, useId, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { formatBytes } from '@/lib/format'
import { validateImageFile } from '@/lib/files'
import { useAssetJob } from '../hooks/useAssetJob'
import {
  STAGE_LABELS,
  STAGE_STATE_LABELS,
  cutoutsOf,
  modelsOf,
  roleLabel,
} from '../services/assetApi'
import type { AssetJob, DerivedAsset } from '../services/assetApi'
import type { TryOnAnchor, TryOnAsset, TryOnAssetKind } from '../types/seller'

/**
 * Photograph → transparent cut-out → an asset the seller can use.
 *
 * This screen is the only place in the dashboard that asks another service to *interpret* a
 * photograph, so it carries the honesty burden for the whole feature:
 *
 *   • **Simulated output is labelled on the screen it appears on.** The pipeline reports whether a
 *     result was computed from the seller's image or produced by a stand-in, and when it was the
 *     latter the review step says so in a banner the seller cannot miss. A green tick over a
 *     fabricated cut-out is exactly the failure this is written to prevent.
 *   • **The service's own sentences are shown verbatim.** Its notes and its failure messages are
 *     written for a seller and say things this component cannot know — that a chain was thinned,
 *     that a 3D stage was skipped, that a retry would be pointless. Paraphrasing them would throw
 *     away the accurate part.
 *   • **Nothing is recorded as approved until the service says it is.** The asset handed back comes
 *     from the server's response to the approve call, not from local state. If that call fails, no
 *     asset is produced, because nothing was actually approved.
 *
 * It renders nothing at all when no processing service is configured. That is deliberate: an
 * action that always fails is worse than no action, and every existing upload path keeps working
 * without the service — see `lib/config.ts`.
 */

export interface AssetProcessorProps {
  /** Recorded on the produced asset, so the try-on client knows where the piece sits. */
  anchor: TryOnAnchor
  /** Called once the service has recorded the approval, with the asset ready to save. */
  onApproved: (asset: TryOnAsset) => void
  disabled?: boolean
}

const ITEM_CONFIGURATION_OPTIONS = [
  { value: 'auto', label: 'Work it out from the photo' },
  { value: 'single', label: 'One piece' },
  { value: 'pair', label: 'A matching pair' },
  { value: 'multiple', label: 'Several pieces' },
]

/** A local preview of the chosen file. Revoked on unmount and on every change. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  return url
}

/**
 * The name the derived file is recorded under.
 *
 * The service reports an asset id and a role, not a filename, so one is derived from the seller's
 * own — which is the only name that will mean anything to them in a file list later.
 */
function outputName(source: string, asset: DerivedAsset): string {
  const base = source.replace(/\.[^./\\]+$/, '').trim() || 'try-on'
  const extension = asset.kind === 'model_3d' ? 'glb' : 'png'
  return `${base}-${asset.role}.${extension}`
}

function toTryOnAsset(asset: DerivedAsset, source: File, anchor: TryOnAnchor): TryOnAsset {
  const kind: TryOnAssetKind = asset.kind === 'model_3d' ? 'glb' : 'image'
  return {
    kind,
    url: asset.url,
    fileName: outputName(source.name, asset),
    // The service reports the media type; the fallbacks only cover a payload that omitted it.
    mimeType: asset.mimeType || (kind === 'glb' ? 'model/gltf-binary' : 'image/png'),
    sizeBytes: asset.sizeBytes,
    anchor,
    origin: 'asset-service',
    uploadedAt: new Date().toISOString(),
  }
}

export function AssetProcessor({ anchor, onApproved, disabled }: AssetProcessorProps) {
  const {
    job,
    source,
    error,
    busy,
    configured,
    choose,
    process,
    retry,
    approve,
    reject,
    reset,
  } = useAssetJob()

  const [localError, setLocalError] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState('auto')
  const [generate3d, setGenerate3d] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Scopes the review radios, so two processors on one form could never share a group.
  const radioGroup = useId()

  const preview = useObjectUrl(source)

  if (!configured) return null

  const message = error ?? localError

  function clear() {
    setLocalError(null)
    setSelectedId(null)
    reset()
  }

  function handleFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setLocalError(null)
    const invalid = validateImageFile(file)
    if (invalid) {
      setLocalError(invalid)
      return
    }
    choose(file)
  }

  function start(overrides?: { itemConfiguration?: string }) {
    setLocalError(null)
    setSelectedId(null)
    void process({
      itemConfiguration: overrides?.itemConfiguration ?? configuration,
      anchor,
      ...(generate3d ? { generate3d: true } : {}),
    })
  }

  async function use(asset: DerivedAsset, file: File) {
    setLocalError(null)
    const fresh = await approve([asset.id])
    const confirmed = fresh?.assets.find((candidate) => candidate.id === asset.id && candidate.approved)
    if (!confirmed || !fresh) {
      // Approval did not land, so no asset exists to record. Saying "done" here would put a
      // rejected result on the product.
      setLocalError('The service did not confirm the approval, so nothing was recorded. Try again.')
      return
    }
    if (fresh.state !== 'approved') {
      setLocalError(
        `The service accepted the approval but reports the job as "${fresh.state}". Check the ` +
          'result before relying on it.',
      )
      return
    }
    onApproved(toTryOnAsset(confirmed, file, anchor))
    clear()
  }

  /* ── Idle: choose a photograph ─────────────────────────────────────────── */

  if (!job && !source) {
    return (
      <div className="ap">
        <div className="ap__intro">
          <p className="ap__intro-title">
            <Icon name="sparkle" size={15} />
            <span>Cut the piece out of a photograph</span>
          </p>
          <p className="field__hint">
            Sends one photo to the asset service, which removes the background and returns a
            transparent image you can use as a try-on overlay. The original is kept; nothing here
            changes your product photo.
          </p>
        </div>

        <label className="ap__drop">
          <input
            className="file-input-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            disabled={disabled}
            aria-label="Choose a photograph to process"
            onChange={(event) => handleFile(event.target.files)}
          />
          <Icon name="upload" size={18} />
          <span>Choose a photograph</span>
        </label>

        <p className="ap__fineprint">
          Do not use a photograph of a person&rsquo;s face. The service is not sent faces, and this
          dashboard does not record them.
        </p>

        {message ? (
          <p className="field__error" role="alert">
            <Icon name="alert" size={13} />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    )
  }

  /* ── Chosen, not yet sent ──────────────────────────────────────────────── */

  if (!job && source) {
    return (
      <div className="ap">
        <div className="ap__source">
          <div className="ap__source-frame">
            {preview ? <img src={preview} alt="" /> : null}
          </div>
          <div>
            <p className="ap__source-name">{source.name}</p>
            <p className="upload__meta">{formatBytes(source.size)}</p>
          </div>
        </div>

        <Field
          label="What is in the photo?"
          hint="A guess that turns out wrong is shown at the review step, where you can correct it and run again."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={configuration}
              disabled={disabled || busy}
              onChange={(event) => setConfiguration(event.target.value)}
              options={ITEM_CONFIGURATION_OPTIONS}
            />
          )}
        </Field>

        <label className="ap__check">
          <input
            type="checkbox"
            checked={generate3d}
            disabled={disabled || busy}
            onChange={(event) => setGenerate3d(event.target.checked)}
          />
          <span>
            <strong>Also try to build a 3D file.</strong> Only where the service has a 3D builder
            configured. Where it does not, the result says so and the flat image is used instead —
            a photograph does not become an accurate 3D model on its own.
          </span>
        </label>

        <div className="ap__actions">
          <Button
            variant="primary"
            size="sm"
            icon="sparkle"
            disabled={disabled || busy}
            loading={busy}
            onClick={() => start()}
          >
            Process this photo
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
            Cancel
          </Button>
        </div>

        {message ? (
          <p className="field__error" role="alert">
            <Icon name="alert" size={13} />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    )
  }

  if (!job) return null

  /* ── Working ───────────────────────────────────────────────────────────── */

  if (job.state !== 'awaiting_review' && job.state !== 'approved' && job.state !== 'failed' && job.state !== 'rejected') {
    return (
      <div className="ap">
        <StageList job={job} />

        {job.detection?.needsSellerConfirmation ? (
          <ConfirmationPrompt
            job={job}
            configuration={configuration}
            disabled={disabled || busy}
            onConfiguration={setConfiguration}
            onRerun={() => start()}
          />
        ) : null}

        {message ? (
          <p className="field__error" role="alert">
            <Icon name="alert" size={13} />
            <span>{message}</span>
          </p>
        ) : null}

        <div className="ap__actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
            Stop watching
          </Button>
        </div>
      </div>
    )
  }

  /* ── Failed ────────────────────────────────────────────────────────────── */

  if (job.state === 'failed') {
    return (
      <div className="ap">
        <div className="callout callout--warning">
          <span className="callout__icon">
            <Icon name="alert" size={15} />
          </span>
          <span>{job.error?.message ?? 'The service could not process this photograph.'}</span>
        </div>

        <StageList job={job} />

        <div className="ap__actions">
          {job.error?.retryable ? (
            <Button
              variant="primary"
              size="sm"
              icon="refresh"
              disabled={disabled || busy}
              loading={busy}
              onClick={() => void retry()}
            >
              Try again
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
            Start over
          </Button>
        </div>

        {/* Explains why the retry button above is absent, rather than leaving the seller to guess. */}
        {job.error && !job.error.retryable ? (
          <p className="ap__fineprint">
            Running this again would fail the same way, so it is not offered. A different
            photograph is what will change the outcome.
          </p>
        ) : null}

        {message ? (
          <p className="field__error" role="alert">
            <Icon name="alert" size={13} />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    )
  }

  /* ── Rejected ──────────────────────────────────────────────────────────── */

  if (job.state === 'rejected') {
    return (
      <div className="ap">
        <div className="callout">
          <span className="callout__icon">
            <Icon name="info" size={15} />
          </span>
          <span>You discarded this result. Nothing from it was saved to the product.</span>
        </div>
        <div className="ap__actions">
          <Button variant="secondary" size="sm" onClick={clear}>
            Start over
          </Button>
        </div>
      </div>
    )
  }

  /* ── Approved ──────────────────────────────────────────────────────────── */

  if (job.state === 'approved') {
    // Reachable only if the caller kept the processor mounted after handing the asset over. Saying
    // what happened is more useful than showing a review screen whose approve button would now 409.
    return (
      <div className="ap">
        <div className="callout callout--info">
          <span className="callout__icon">
            <Icon name="check" size={15} />
          </span>
          <span>The service has recorded this asset as approved.</span>
        </div>
        <div className="ap__actions">
          <Button variant="secondary" size="sm" onClick={clear}>
            Process another photo
          </Button>
        </div>
      </div>
    )
  }

  /* ── Review ────────────────────────────────────────────────────────────── */

  const cutouts = cutoutsOf(job)
  const models = modelsOf(job)
  const selected = cutouts.find((candidate) => candidate.id === selectedId) ?? cutouts[0] ?? null

  return (
    <div className="ap">
      {job.simulated ? (
        <div className="callout callout--warning">
          <span className="callout__icon">
            <Icon name="alert" size={15} />
          </span>
          <span>
            <strong>This result is simulated.</strong> The service that produced it is running a
            built-in stand-in rather than a real model, so what you see is a placeholder that shows
            the workflow working. Do not treat the cut-out as an accurate isolation of your piece.
          </span>
        </div>
      ) : null}

      {detectionLine(job)}

      {cutouts.length > 0 ? (
        <div className="ap__review">
          <p className="ap__review-head">
            Choose the image to use for try-on
            {cutouts.length > 1 ? ' — one per piece the service separated out' : ''}
          </p>

          <div className="ap__options">
            {cutouts.map((asset) => (
              <label
                key={asset.id}
                className={[
                  'ap__option',
                  selected?.id === asset.id ? 'ap__option--on' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  type="radio"
                  name={radioGroup}
                  value={asset.id}
                  checked={selected?.id === asset.id}
                  disabled={disabled || busy}
                  onChange={() => setSelectedId(asset.id)}
                />
                <span className="ap__option-frame">
                  <img src={asset.url} alt={`${roleLabel(asset.role)} cut-out`} />
                </span>
                <span className="ap__option-body">
                  <span className="ap__option-name">{roleLabel(asset.role)}</span>
                  <span className="upload__meta">
                    {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                    {asset.sizeBytes ? formatBytes(asset.sizeBytes) : ''}
                  </span>
                  {asset.simulated ? <Badge tone="warning">Simulated</Badge> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="callout callout--warning">
          <span className="callout__icon">
            <Icon name="alert" size={15} />
          </span>
          <span>No usable image came back, so there is nothing to use.</span>
        </div>
      )}

      {models.length > 0 ? (
        <div className="ap__review">
          <p className="ap__review-head">A 3D file was also built</p>
          <div className="ap__options">
            {models.map((asset) => (
              <div key={asset.id} className="ap__option ap__option--static">
                <span className="ap__option-body">
                  <span className="ap__option-name">{roleLabel(asset.role)} · 3D file</span>
                  <span className="upload__meta">
                    {asset.sizeBytes ? formatBytes(asset.sizeBytes) : ''}
                  </span>
                  {asset.simulated ? (
                    <Badge tone="warning">Simulated — a flat card, not a real model</Badge>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled || busy || !source}
                    onClick={() => source && void use(asset, source)}
                  >
                    Use the 3D file instead
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {job.notes.length > 0 ? (
        <div className="ap__notes">
          <p className="ap__review-head">What the service reported</p>
          <ul>
            {job.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {job.detection?.needsSellerConfirmation ? (
        <ConfirmationPrompt
          job={job}
          configuration={configuration}
          disabled={disabled || busy}
          onConfiguration={setConfiguration}
          onRerun={() => start()}
        />
      ) : null}

      <div className="ap__actions">
        <Button
          variant="primary"
          size="sm"
          icon="check"
          disabled={disabled || busy || !selected || !source}
          loading={busy}
          onClick={() => {
            if (selected && source) void use(selected, source)
          }}
        >
          Use this image
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          disabled={disabled || busy}
          onClick={() => void reject('The seller discarded this result.')}
        >
          Discard
        </Button>
      </div>

      {message ? (
        <p className="field__error" role="alert">
          <Icon name="alert" size={13} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function StageList({ job }: { job: AssetJob }) {
  return (
    <div className="ap__stages">
      <div className="ap__stages-head">
        <p className="ap__review-head">Progress</p>
        <span className="ap__pct">{Math.round(job.progress * 100)}%</span>
      </div>

      <div className="ap__bar" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>

      <ul className="ap__stage-list">
        {job.stages.map((stage) => (
          <li key={stage.stage} className={`ap__stage ap__stage--${stage.state}`}>
            <span className="ap__stage-mark" aria-hidden="true">
              <Icon
                name={
                  stage.state === 'succeeded'
                    ? 'check'
                    : stage.state === 'failed'
                      ? 'alert'
                      : stage.state === 'running'
                        ? 'refresh'
                        : 'clock'
                }
                size={13}
              />
            </span>
            <span className="ap__stage-name">{STAGE_LABELS[stage.stage] ?? stage.stage}</span>
            <span className="ap__stage-state">{STAGE_STATE_LABELS[stage.state] ?? stage.state}</span>
            {stage.message ? <span className="ap__stage-msg">{stage.message}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The correction step for an uncertain detection.
 *
 * The pipeline is allowed to say it is unsure, and this is what that looks like: the service's own
 * explanation, the seller's answer, and a re-run with that answer attached. Without this the
 * uncertainty would be reported and then unresolvable.
 */
function ConfirmationPrompt({
  job,
  configuration,
  disabled,
  onConfiguration,
  onRerun,
}: {
  job: AssetJob
  configuration: string
  disabled: boolean
  onConfiguration: (value: string) => void
  onRerun: () => void
}) {
  return (
    <div className="callout callout--info">
      <span className="callout__icon">
        <Icon name="info" size={15} />
      </span>
      <span className="ap__confirm">
        <span>
          <strong>The service was not sure what it found.</strong>{' '}
          {job.detection?.explanation ?? ''}
        </span>

        <span className="ap__confirm-row">
          <Select
            aria-label="What is in the photograph"
            value={configuration}
            disabled={disabled}
            onChange={(event) => onConfiguration(event.target.value)}
            options={ITEM_CONFIGURATION_OPTIONS}
          />
          <Button variant="secondary" size="sm" icon="refresh" disabled={disabled} onClick={onRerun}>
            Run again with this
          </Button>
        </span>
      </span>
    </div>
  )
}

/** The service's one-line account of what it decided, when it decided anything. */
function detectionLine(job: AssetJob) {
  const detection = job.detection
  if (!detection || !detection.explanation) return null

  return (
    <p className="ap__detection">
      <Icon name="eye" size={14} />
      <span>{detection.explanation}</span>
      <span className="ap__detection-count">
        {detection.itemCount === 1 ? '1 piece found' : `${detection.itemCount} pieces found`}
      </span>
    </p>
  )
}
