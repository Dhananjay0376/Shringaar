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
import { createId } from '@/lib/id'
import type { ProductImage, TryOnAnchor, TryOnAsset, TryOnAssetKind } from '../types/seller'
import { ImageUploadField } from './ImageUploadField'

/**
 * The try-on asset editor.
 *
 * This field is deliberately separate from the product photo, and it is the one place the UI has to
 * be most careful about what it promises:
 *
 *   • A product photo is NOT converted into a 3D model. Nothing in this system does that.
 *   • `image` means a cut-out placed as a 2D overlay — genuinely useful, and available today.
 *   • `glb` / `usdz` mean a real 3D asset authored elsewhere. A browser cannot upload those to file
 *     storage, so in demo mode the choice and the file metadata are recorded while the bytes are
 *     not stored. The UI says exactly that instead of showing a success state.
 *
 * See arch.md §8.
 */

export interface TryOnAssetFieldProps {
  value: TryOnAsset | null
  onChange: (next: TryOnAsset | null) => void
  /** Pre-selected placement when the product has no asset yet. */
  suggestedAnchor: TryOnAnchor
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
  error,
  disabled,
}: TryOnAssetFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [modelError, setModelError] = useState<string | null>(null)

  const asset = value ?? emptyAsset('none', suggestedAnchor)
  const isModel = asset.kind === 'glb' || asset.kind === 'usdz'
  const needsUpload = asset.kind !== 'none' && !asset.url

  function handleKindChange(kind: TryOnAssetKind) {
    setModelError(null)
    onChange(emptyAsset(kind, asset.anchor))
  }

  function handleModelFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setModelError(null)

    const invalid = validateModelFile(file)
    if (invalid) {
      setModelError(invalid)
      return
    }

    const meta = describeModelFile(file)

    onChange({
      ...asset,
      kind: meta.mimeType.includes('usdz') ? 'usdz' : 'glb',
      // Recorded, not stored: a browser cannot put these bytes into file storage.
      url: null,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      origin: 'local-preview',
      uploadedAt: new Date().toISOString(),
    })

    if (fileRef.current) fileRef.current.value = ''
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
        <ImageUploadField
          noun="try-on overlay image"
          title="2D overlay image"
          hint="A cut-out of the piece on a transparent or plain background. This is overlaid on the camera feed rather than fitted in 3D."
          value={overlayValue}
          onChange={handleOverlayChange}
          disabled={disabled}
        />
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
                  disabled={disabled}
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
            This product is marked as having a 3D try-on asset, but the file has not been stored.
            Saving records the choice and the file details; the asset itself needs file storage, which
            requires a connected backend. Until then the product page shows try-on as unavailable.
          </span>
        </div>
      ) : null}

      {asset.url && asset.kind === 'image' ? (
        <div className="callout callout--info">
          <span className="callout__icon">
            <Icon name="check" size={15} />
          </span>
          <span>
            The overlay is held in this browser for the demo. A connected backend stores it in the{' '}
            <span className="mono">tryon-assets</span> bucket.
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

/** Unused id helper kept adjacent to the asset builders that use it. */
export const tryOnAssetId = () => createId('tryon')
