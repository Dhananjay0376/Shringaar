import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import {
  TRYON_ANCHOR_LABELS,
  TRYON_ANCHORS,
  TRYON_ASSET_KIND_LABELS,
  TRYON_ASSET_KINDS,
} from '@/lib/catalog'
import { describeModelFile, validateModelFile } from '@/lib/files'
import { formatBytes } from '@/lib/format'
import { isServiceError } from '../types/seller'
import type { ProductImage, TryOnAnchor, TryOnAsset, TryOnAssetKind } from '../types/seller'
import type { UploadKit } from '../hooks/useUploadKit'
import { isAssetApiConfigured } from '../services/assetApi'
import { AssetProcessor } from './AssetProcessor'
import { ImageUploadField } from './ImageUploadField'

/**
 * The try-on asset editor.
 *
 * This field is deliberately separate from the product photo, and it is the one place the UI has to
 * be most careful about what it promises:
 *
 *   • A product photo is NOT converted into a 3D model. Nothing in this system does that.
 *   • `image` means a cut-out placed as a 2D overlay — genuinely useful, and available today.
 *   • `glb` / `usdz` mean a real 3D asset authored elsewhere, in a modelling tool. They are stored
 *     as-is; nothing here generates one.
 *
 * What the field can promise about *storage* depends on the backend, which is why it takes
 * `uploads`: given uploaders, a chosen file is put in `tryon-assets`; without them — demo mode — the
 * choice and the file's details are recorded while the bytes stay in the browser, and the UI says
 * exactly that rather than showing a success state that is not true.
 *
 * See arch.md §8.
 */

export interface TryOnAssetFieldProps {
  value: TryOnAsset | null
  onChange: (next: TryOnAsset | null) => void
  /** Pre-selected placement when the product has no asset yet. */
  suggestedAnchor: TryOnAnchor
  /** Where to put the bytes, or nothing when this backend has no object storage. */
  uploads?: UploadKit
  error?: string
  disabled?: boolean
}

function emptyAsset(kind: TryOnAssetKind, anchor: TryOnAnchor): TryOnAsset {
  return {
    kind,
    url: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    anchor,
    origin: kind === 'none' ? 'demo-seed' : 'local-preview',
    uploadedAt: null,
  }
}

export function TryOnAssetField({
  value,
  onChange,
  suggestedAnchor,
  uploads,
  error,
  disabled,
}: TryOnAssetFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  //: The processing service is optional, so its panel is opened on request rather than stacked
  //: under the ordinary picker, where two drop zones would look like the same choice twice.
  const [showProcessor, setShowProcessor] = useState(false)

  const asset = value ?? emptyAsset('none', suggestedAnchor)
  const isModel = asset.kind === 'glb' || asset.kind === 'usdz'
  const needsUpload = asset.kind !== 'none' && !asset.url
  const canStore = Boolean(uploads?.tryOnModel)
  const processorAvailable = isAssetApiConfigured()

  function handleKindChange(kind: TryOnAssetKind) {
    setModelError(null)
    onChange(emptyAsset(kind, asset.anchor))
  }

  async function handleModelFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setModelError(null)

    const invalid = validateModelFile(file)
    if (invalid) {
      setModelError(invalid)
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    const meta = describeModelFile(file)
    const kind: TryOnAssetKind = meta.mimeType.includes('usdz') ? 'usdz' : 'glb'

    // Without storage there is nowhere to put a 45 MB mesh, so the choice and the file's details
    // are recorded and the field says plainly that the bytes are not stored. With storage the file
    // is uploaded first and only then recorded — a failure here must not look like a success.
    if (!uploads?.tryOnModel) {
      onChange({
        ...asset,
        kind,
        url: null,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        origin: 'local-preview',
        uploadedAt: new Date().toISOString(),
      })

      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setBusy(true)
    try {
      const stored = await uploads.tryOnModel(file, () => {})
      onChange({
        ...asset,
        kind,
        anchor: asset.anchor,
        url: stored.url,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        origin: stored.origin,
        uploadedAt: stored.uploadedAt,
      })
    } catch (cause) {
      setModelError(
        isServiceError(cause)
          ? cause.message
          : 'That file could not be stored. Try again, or choose a different file.',
      )
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** The 2D path reuses the image picker, since it is an ordinary image file. */
  function handleOverlayChange(next: ProductImage | null) {
    if (!next) {
      onChange({ ...asset, url: null, fileName: null, mimeType: null, sizeBytes: null, uploadedAt: null })
      return
    }

    onChange({
      ...asset,
      kind: 'image',
      url: next.url,
      fileName: next.fileName,
      mimeType: next.mimeType,
      sizeBytes: next.sizeBytes,
      origin: next.origin,
      uploadedAt: next.uploadedAt,
    })
  }

  const overlayValue: ProductImage | null =
    asset.kind === 'image' && asset.url
      ? {
          id: 'tryon-overlay',
          url: asset.url,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: null,
          height: null,
          origin: asset.origin,
          uploadedAt: asset.uploadedAt,
        }
      : null

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="callout">
        <span className="callout__icon">
          <Icon name="info" size={15} />
        </span>
        <span>
          <strong>A try-on asset is separate from your product photo.</strong> Uploading a photo of a
          ring does not produce a 3D model — nothing here converts one into the other. A photo is used
          as a 2D overlay; a <span className="mono">.glb</span> or <span className="mono">.usdz</span>{' '}
          file is needed for full 3D try-on, and those are authored separately.
        </span>
      </div>

      <div className="form-grid">
        <Field label="Try-on type" required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid || Boolean(error)}
              value={asset.kind}
              disabled={disabled}
              onChange={(event) => handleKindChange(event.target.value as TryOnAssetKind)}
              options={TRYON_ASSET_KINDS.map((kind) => ({
                value: kind,
                label: TRYON_ASSET_KIND_LABELS[kind],
              }))}
            />
          )}
        </Field>

        <Field
          label="Placement hint"
          hint="Tells the try-on client roughly where this piece sits. It is a hint, not a measurement."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={asset.anchor}
              disabled={disabled || asset.kind === 'none'}
              onChange={(event) =>
                onChange({ ...asset, anchor: event.target.value as TryOnAnchor })
              }
              options={TRYON_ANCHORS.map((anchor) => ({
                value: anchor,
                label: TRYON_ANCHOR_LABELS[anchor],
              }))}
            />
          )}
        </Field>
      </div>

      {asset.kind === 'image' ? (
        <>
          <ImageUploadField
            noun="try-on overlay image"
            title="2D overlay image"
            hint="A cut-out of the piece on a transparent or plain background. This is overlaid on the camera feed rather than fitted in 3D."
            value={overlayValue}
            onChange={handleOverlayChange}
            upload={uploads?.tryOnImage}
            disabled={disabled}
          />

          {processorAvailable ? (
            <div className="ap-panel">
              <div className="ap-panel__head">
                <span>
                  <strong>No cut-out yet?</strong> The asset service can remove the background from
                  an ordinary photograph and hand back a transparent image.
                </span>
                <Button
                  variant="link"
                  size="sm"
                  disabled={disabled}
                  aria-expanded={showProcessor}
                  onClick={() => setShowProcessor((open) => !open)}
                >
                  {showProcessor ? 'Hide' : 'Cut one out of a photo'}
                </Button>
              </div>

              {showProcessor ? (
                <AssetProcessor
                  anchor={asset.anchor}
                  disabled={disabled}
                  onApproved={(produced) => {
                    // The asset arrives already approved by the service; recording it here is the
                    // only step left, and closing the panel shows the result in the field above.
                    setShowProcessor(false)
                    onChange(produced)
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {isModel ? (
        <div className={['upload', modelError ? 'upload--error' : ''].filter(Boolean).join(' ')}>
          <div className="upload__row">
            <div className="upload__preview">
              <span className="upload__preview-icon">
                <Icon name={asset.url ? 'check' : 'package'} size={22} />
                <span className="sr-only">
                  {asset.url ? '3D asset stored' : 'No 3D asset stored'}
                </span>
              </span>
            </div>

            <div className="upload__body">
              <p className="upload__title">
                {asset.kind === 'glb' ? 'glTF binary (.glb)' : 'USDZ (.usdz)'}
              </p>
              <p className="field__hint">
                {asset.kind === 'glb'
                  ? 'glTF is the format the try-on engine renders for web and Android.'
                  : 'USDZ is the format iOS Quick Look and Safari AR use.'}
              </p>

              {asset.fileName ? (
                <p className="upload__meta">
                  {asset.fileName}
                  {asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ''}
                </p>
              ) : (
                <p className="upload__meta text-muted">No file selected</p>
              )}

              <div className="upload__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="upload"
                  disabled={disabled || busy}
                  loading={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {asset.fileName ? 'Replace file' : 'Choose 3D file'}
                </Button>

                {asset.fileName ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...asset,
                        url: null,
                        fileName: null,
                        mimeType: null,
                        sizeBytes: null,
                        uploadedAt: null,
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <input
            ref={fileRef}
            className="file-input-hidden"
            type="file"
            accept=".glb,.usdz,model/gltf-binary,model/vnd.usdz+zip"
            aria-label="Choose a 3D try-on model file"
            onChange={(event) => handleModelFile(event.target.files)}
          />

          {modelError ? (
            <p className="field__error" role="alert" style={{ marginTop: 'var(--sp-3)' }}>
              <Icon name="alert" size={13} />
              <span>{modelError}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {needsUpload ? (
        <div className="callout callout--warning">
          <span className="callout__icon">
            <Icon name="alert" size={15} />
          </span>
          <span>
            {canStore ? (
              <>
                This product is marked as having a 3D try-on asset, but no file has been chosen yet.
                Saving records the choice and the file details; the product page shows try-on as
                unavailable until the file itself is stored.
              </>
            ) : (
              <>
                This product is marked as having a 3D try-on asset, but the file has not been stored.
                Saving records the choice and the file details; storing the asset itself needs file
                storage, which requires a connected backend. Until then the product page shows try-on
                as unavailable.
              </>
            )}
          </span>
        </div>
      ) : null}

      {asset.url && asset.kind === 'image' ? (
        <div className="callout callout--info">
          <span className="callout__icon">
            <Icon name="check" size={15} />
          </span>
          <span>
            {asset.origin === 'storage' ? (
              <>
                Stored in the <span className="mono">tryon-assets</span> bucket, separately from your
                product photos.
              </>
            ) : asset.origin === 'asset-service' ? (
              <>
                Produced by the asset service and served from it, not from your product photo
                storage. Saving stores the address the service returned, so this image is only as
                available as that service is.
              </>
            ) : (
              <>
                The overlay is held in this browser for the demo. A connected backend stores it in the{' '}
                <span className="mono">tryon-assets</span> bucket.
              </>
            )}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/** Convenience for callers that need a fresh asset value with the default anchor applied. */
export function createEmptyTryOnAsset(anchor: TryOnAnchor = 'unspecified'): TryOnAsset {
  return emptyAsset('none', anchor)
}

/** Re-exported so the form does not need to import from lib/catalog as well. */
export { CATEGORY_DEFAULT_ANCHOR } from '@/lib/catalog'
