import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { formatBytes } from '@/lib/format'
import { readImageFile, validateImageFile } from '@/lib/files'
import { createId } from '@/lib/id'
import type { ProductImage } from '../types/seller'

/**
 * Image picker with an inline preview.
 *
 * Validation (MIME type, size) runs before the file is read, and the decoded dimensions are kept
 * with the asset so the storefront and AR client can reason about the image without re-fetching it.
 *
 * In demo mode the bytes are held as a data URL in this browser. A connected backend uploads to
 * storage instead — `origin` records which of the two happened, and the form says so in words.
 */

export interface ImageUploadFieldProps {
  /** Used in the input's accessible name, e.g. "product image". */
  noun: string
  title: string
  hint: string
  value: ProductImage | null
  onChange: (next: ProductImage | null) => void
  error?: string
  disabled?: boolean
}

export function ImageUploadField({
  noun,
  title,
  hint,
  value,
  onChange,
  error,
  disabled,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const message = error ?? localError

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
    try {
      const result = await readImageFile(file)
      onChange({
        id: value?.id ?? createId('img'),
        url: result.dataUrl,
        fileName: result.fileName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        origin: 'local-preview',
        uploadedAt: new Date().toISOString(),
      })
    } catch {
      setLocalError('That file could not be read. Try a different image.')
    } finally {
      setBusy(false)
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
              {value ? 'Replace image' : 'Choose image'}
            </Button>

            {value ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={disabled}
                onClick={() => {
                  setLocalError(null)
                  onChange(null)
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>

          {value && value.origin === 'local-preview' ? (
            <p className="upload__meta">
              Held in this browser for the demo. Nothing has been uploaded to file storage.
            </p>
          ) : null}
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
