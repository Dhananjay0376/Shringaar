import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { formatBytes } from '@/lib/format'
import { readImageFile, validateImageFile } from '@/lib/files'
import { createId } from '@/lib/id'
import { isServiceError } from '../types/seller'
import type { AssetUploader, ProductImage, UploadPhase } from '../types/seller'

/**
 * Image picker with an inline preview.
 *
 * Validation (MIME type, size) runs before the file is read, and the decoded dimensions are kept
 * with the asset so the storefront and AR client can reason about the image without re-fetching it.
 *
 * Two things can happen to the bytes, and the field does not choose between them: it either stores
 * them through the `upload` it was handed, or holds them as a data URL in this browser. `origin`
 * records which, and the note under the actions says so in words — so a seller is never left
 * believing a preview is a published photograph.
 */

/**
 * Progress is reported as a phase, never a bar.
 *
 * `supabase-js` uploads through `fetch`, which exposes no byte-level progress. A bar driven by a
 * timer would reach 100% while bytes were still going out, which teaches the seller to distrust it
 * exactly when a large file is genuinely slow. The phase is something the client truly knows.
 */
const PHASE_LABELS: Record<UploadPhase, string> = {
  validating: 'Checking the file…',
  uploading: 'Uploading…',
  finishing: 'Finishing…',
}

export interface ImageUploadFieldProps {
  /** Used in the input's accessible name, e.g. "product image". */
  noun: string
  title: string
  hint: string
  value: ProductImage | null
  onChange: (next: ProductImage | null) => void
  /**
   * Where to put the bytes. Omitted when this backend has no object storage — the field then keeps
   * a browser-held preview, which is what demo mode honestly does. See `useUploadKit`.
   */
  upload?: AssetUploader
  error?: string
  disabled?: boolean
}

export function ImageUploadField({
  noun,
  title,
  hint,
  value,
  onChange,
  upload,
  error,
  disabled,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<UploadPhase | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const message = error ?? localError
  const actionLabel = phase ? PHASE_LABELS[phase] : value ? 'Replace image' : 'Choose image'

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setLocalError(null)

    const invalid = validateImageFile(file)
    if (invalid) {
      setLocalError(invalid)
      return
    }

    setBusy(true)
    setPhase(upload ? 'validating' : null)

    try {
      // The identity is kept across a replacement so React does not remount the preview mid-edit,
      // and so the form's "did this change?" comparison stays about the picture, not the file name.
      const id = value?.id ?? createId('img')

      if (upload) {
        const stored = await upload(file, ({ phase: next }) => setPhase(next))
        onChange({ id, width: null, height: null, ...stored })
        return
      }

      const result = await readImageFile(file)
      onChange({
        id,
        url: result.dataUrl,
        fileName: result.fileName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        origin: 'local-preview',
        uploadedAt: new Date().toISOString(),
      })
    } catch (cause) {
      // A `ServiceError` already carries a sentence written for the seller — a size limit, a type
      // the bucket refuses, a session that expired. Anything else is genuinely unexplained.
      setLocalError(
        isServiceError(cause)
          ? cause.message
          : 'That image could not be saved. Try again, or choose a different file.',
      )
    } finally {
      setBusy(false)
      setPhase(null)
      // Reset so choosing the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={['upload', message ? 'upload--error' : ''].filter(Boolean).join(' ')}>
      <div className="upload__row">
        <div className="upload__preview">
          {value ? (
            <img src={value.url} alt={`${noun} preview`} />
          ) : (
            <span className="upload__preview-icon">
              <Icon name="camera" size={22} />
              <span className="sr-only">No {noun} selected</span>
            </span>
          )}
        </div>

        <div className="upload__body">
          <p className="upload__title">{title}</p>
          <p className="field__hint">{hint}</p>

          {value ? (
            <p className="upload__meta">
              {value.fileName ?? 'Uploaded image'}
              {value.sizeBytes ? ` · ${formatBytes(value.sizeBytes)}` : ''}
              {value.width && value.height ? ` · ${value.width}×${value.height}` : ''}
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
              onClick={() => inputRef.current?.click()}
            >
              {actionLabel}
            </Button>

            {value ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={disabled || busy}
                onClick={() => {
                  setLocalError(null)
                  onChange(null)
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>

          {value ? <OriginNote origin={value.origin} /> : null}
        </div>
      </div>

      <input
        ref={inputRef}
        className="file-input-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        aria-label={`Choose a ${noun}`}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {message ? (
        <p className="field__error" role="alert" style={{ marginTop: 'var(--sp-3)' }}>
          <Icon name="alert" size={13} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * Says where the bytes actually are, in the seller's words.
 *
 * Three states, and the difference matters more than it looks: a seeded example and a browser-held
 * preview are not files anyone can fetch, while a stored object is. Saying nothing for the stored
 * case is deliberate — a successful upload needs no caption, and adding "uploaded successfully" to
 * every screenshot would be noise on the one case the seller already expects.
 *
 * `asset-service` is the fourth and is silent here on purpose: a try-on overlay produced by the
 * processing service arrives through `TryOnAssetField`, which states the provenance in its own
 * callout directly under the preview. Repeating it here would put the same sentence on screen twice.
 */
function OriginNote({ origin }: { origin: ProductImage['origin'] }) {
  if (origin === 'local-preview') {
    return (
      <p className="upload__meta">
        Held in this browser as a preview. Nothing has been uploaded to file storage, so only you can
        see this.
      </p>
    )
  }

  if (origin === 'demo-seed') {
    return <p className="upload__meta">This is example artwork, not a file you uploaded.</p>
  }

  return null
}
