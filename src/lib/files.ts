/**
 * File reading and validation for the product image and try-on asset uploads.
 *
 * Demo mode keeps the file in the browser as a data URL. The same validation rules are written to
 * mirror what storage-level validation must enforce server-side (arch.md §7.4) — a client check is
 * a UX affordance, never a security boundary.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_TRACKED_DATA_URL_BYTES = 400 * 1024 // larger images are preview-only in demo mode
export const MAX_MODEL_BYTES = 25 * 1024 * 1024 // 25 MB — .glb
export const MAX_USDZ_BYTES = 15 * 1024 * 1024 // 15 MB — .usdz

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export const MODEL_MIME_TYPES = ['model/gltf-binary', 'model/vnd.usdz+zip'] as const

export interface ReadFileResult {
  dataUrl: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  /** True when the file is too large to keep across reloads in demo mode. */
  previewOnly: boolean
}

/** Returns a human-readable error, or null when the file is acceptable. */
export function validateImageFile(file: File): string | null {
  if (!IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number])) {
    return 'Use a JPEG, PNG, WebP or AVIF image.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `Image is ${formatSize(file.size)}. The limit is ${formatSize(MAX_IMAGE_BYTES)}.`
  }
  return null
}

/** Model assets are accepted by extension as well as MIME type — browsers report .glb inconsistently. */
export function validateModelFile(file: File): string | null {
  const name = file.name.toLowerCase()
  const isModelMime = MODEL_MIME_TYPES.includes(file.type as (typeof MODEL_MIME_TYPES)[number])
  const isGlb = name.endsWith('.glb')
  const isUsdz = name.endsWith('.usdz')

  if (!isModelMime && !isGlb && !isUsdz) {
    return 'Use a .glb or .usdz 3D model file.'
  }

  const limit = isUsdz ? MAX_USDZ_BYTES : MAX_MODEL_BYTES
  if (file.size > limit) {
    return `Model is ${formatSize(file.size)}. The limit for this format is ${formatSize(limit)}.`
  }

  return null
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('The file could not be read as data.'))
      }
    }

    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()

    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

/** Reads an image, returning its data URL plus decoded dimensions when they are available. */
export async function readImageFile(file: File): Promise<ReadFileResult> {
  const dataUrl = await readFileAsDataUrl(file)
  const dimensions = await readImageDimensions(dataUrl)

  return {
    dataUrl,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    previewOnly: file.size > MAX_TRACKED_DATA_URL_BYTES,
  }
}

/** Non-image assets (3D models) are tracked by metadata only — the bytes are not held in memory. */
export function describeModelFile(file: File): Omit<ReadFileResult, 'dataUrl' | 'width' | 'height'> {
  return {
    fileName: file.name,
    mimeType: file.type || guessModelMime(file.name),
    sizeBytes: file.size,
    previewOnly: true,
  }
}

function guessModelMime(fileName: string): string {
  return fileName.toLowerCase().endsWith('.usdz') ? 'model/vnd.usdz+zip' : 'model/gltf-binary'
}

/** `https://…/a.glb?token=1` → `a.glb`. Used to show a readable asset name from a stored URL. */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const last = path.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : url
  } catch {
    return url.split('/').filter(Boolean).pop() ?? url
  }
}
