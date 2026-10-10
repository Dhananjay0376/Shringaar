import { config } from '@/lib/config'
import { ServiceError } from '../types/seller'

/**
 * Client for the asset-processing service (`backend/`, FastAPI).
 *
 * **This module is only ever reached when `VITE_ASSET_API_URL` is set.** Every entry point checks
 * that first and throws a `ServiceError` when it is not, so a caller that forgets to gate on
 * `isAssetApiConfigured()` gets an honest failure rather than a request to `undefined/api/jobs`.
 * The UI gates earlier than that — it does not render the action at all.
 *
 * Two design choices worth stating:
 *
 * 1. **The server's payload is parsed, not trusted.** `parseJob` reads each field it needs and
 *    throws if the shape is wrong. The alternative — casting the JSON to an interface — makes a
 *    version mismatch render as `undefined` in a table cell, which looks like a bug in the
 *    dashboard rather than what it is.
 * 2. **The server's own sentences are preferred over invented ones.** Validation failures carry a
 *    `detail` written for the seller ("This image is 14.2 MB. The limit is 12 MB — try exporting it
 *    at a smaller size."). Replacing that with "Upload failed" would throw away the only useful
 *    part of the response.
 */

/* ── The shape the UI needs ─────────────────────────────────────────────── */

export type AssetJobState =
  | 'uploaded'
  | 'queued'
  | 'validating'
  | 'preprocessing'
  | 'segmenting'
  | 'generating_2d'
  | 'generating_3d'
  | 'validating_assets'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'failed'

export type AssetStageState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export type DerivedAssetKind = 'cutout_2d' | 'model_3d'

export interface AssetStage {
  stage: string
  state: AssetStageState
  message: string | null
  durationMs: number | null
}

export interface DerivedAsset {
  id: string
  kind: DerivedAssetKind
  /** `primary` · `left` · `right` · `item_1`…`item_3`. */
  role: string
  url: string
  /** Reported by the service rather than assumed, so the stored asset carries the real type. */
  mimeType: string
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** True when the pipeline that produced this asset did not really analyse the image. */
  simulated: boolean
  approved: boolean
}

export interface AssetJobError {
  code: string
  stage: string
  message: string
  /** False when re-running would fail identically, which is what gates the Retry button. */
  retryable: boolean
}

export interface AssetJobDetection {
  itemCount: number
  resolvedConfiguration: string
  needsSellerConfirmation: boolean
  explanation: string
}

export interface AssetJob {
  id: string
  state: AssetJobState
  /** 0–1, counted over settled stages. */
  progress: number
  /** True when *any* part of this job came from a simulated provider. */
  simulated: boolean
  stages: AssetStage[]
  assets: DerivedAsset[]
  detection: AssetJobDetection | null
  error: AssetJobError | null
  notes: string[]
}

/** The states after which the pipeline will not change the job again. */
const TERMINAL_STATES: readonly AssetJobState[] = ['awaiting_review', 'approved', 'rejected', 'failed']

/** States in which the server is still working, and the client should keep polling. */
export function isJobSettled(state: AssetJobState): boolean {
  return TERMINAL_STATES.includes(state)
}

/* ── Configuration ──────────────────────────────────────────────────────── */

export function isAssetApiConfigured(): boolean {
  return config.assetApiUrl !== null
}

function baseUrl(): string {
  const url = config.assetApiUrl
  if (!url) {
    throw new ServiceError(
      'not_implemented',
      'No asset processing service is configured, so photos cannot be turned into try-on assets.',
    )
  }
  return url
}

/* ── Payload parsing ────────────────────────────────────────────────────── */

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServiceError('unknown', `The asset service returned an unexpected ${what}.`)
  }
  return value as Record<string, unknown>
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseStage(raw: unknown): AssetStage {
  const record = asRecord(raw, 'processing stage')
  return {
    stage: str(record.stage, 'unknown'),
    state: str(record.state, 'pending') as AssetStageState,
    message: nullableStr(record.message),
    durationMs: nullableNum(record.duration_ms),
  }
}

function parseAsset(raw: unknown): DerivedAsset {
  const record = asRecord(raw, 'asset')
  const kind = str(record.kind)
  if (kind !== 'cutout_2d' && kind !== 'model_3d') {
    throw new ServiceError('unknown', `The asset service returned an unknown asset kind '${kind}'.`)
  }
  return {
    id: str(record.id),
    kind,
    role: str(record.role, 'primary'),
    url: str(record.url),
    mimeType: str(record.mime_type),
    width: nullableNum(record.width),
    height: nullableNum(record.height),
    sizeBytes: nullableNum(record.size_bytes),
    simulated: bool(record.simulated),
    approved: bool(record.approved),
  }
}

function parseError(raw: unknown): AssetJobError | null {
  if (raw === null || raw === undefined) return null
  const record = asRecord(raw, 'error')
  return {
    code: str(record.code, 'unknown'),
    stage: str(record.stage),
    message: str(record.message, 'Processing failed.'),
    retryable: bool(record.retryable),
  }
}

function parseDetection(raw: unknown): AssetJobDetection | null {
  if (raw === null || raw === undefined) return null
  const record = asRecord(raw, 'detection summary')
  return {
    itemCount: num(record.item_count),
    resolvedConfiguration: str(record.resolved_configuration, 'single'),
    needsSellerConfirmation: bool(record.needs_seller_confirmation),
    explanation: str(record.explanation),
  }
}

/** Read a job payload the server sent into the shape the UI works with. */
export function parseJob(raw: unknown): AssetJob {
  const record = asRecord(raw, 'job')
  const id = str(record.id)
  if (!id) {
    throw new ServiceError('unknown', 'The asset service returned a job with no id.')
  }

  return {
    id,
    state: str(record.state, 'failed') as AssetJobState,
    progress: num(record.progress),
    simulated: bool(record.simulated),
    stages: list(record.stages).map(parseStage),
    assets: list(record.assets).map(parseAsset),
    detection: parseDetection(record.detection),
    error: parseError(record.error),
    notes: list(record.notes).map((note) => str(note)),
  }
}

/* ── Transport ──────────────────────────────────────────────────────────── */

/**
 * Turn a non-2xx response into a `ServiceError`, preferring the server's own sentence.
 *
 * `detail` is FastAPI's field for that, and the backend writes it for a seller — a size limit, an
 * unsupported format, a retry that is not permitted. It is used verbatim when present.
 */
async function failure(response: Response, what: string): Promise<ServiceError> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      detail = str((body as Record<string, unknown>).detail)
    }
  } catch {
    // A body that is not JSON is not worth reporting; the status is.
  }

  const code =
    response.status === 400
      ? 'validation'
      : response.status === 404
        ? 'not_found'
        : response.status === 409
          ? 'conflict'
          : 'unknown'

  return new ServiceError(
    code,
    detail || `${what} failed (the service responded ${response.status}).`,
  )
}

/** A network-level failure, which is a different sentence from a refusal. */
function unreachable(cause: unknown): ServiceError {
  const reason = cause instanceof Error ? cause.message : 'the request could not be sent'
  return new ServiceError(
    'unknown',
    `The asset service could not be reached (${reason}). Check that it is running.`,
  )
}

async function send(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${baseUrl()}${path}`
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (cause) {
    throw unreachable(cause)
  }
  if (!response.ok) throw await failure(response, 'The request')
  if (response.status === 204) return null
  return response.json()
}

/* ── Endpoints ──────────────────────────────────────────────────────────── */

export interface CreateAssetJobInput {
  file: File
  /** Displayed back by the service; never used to decide the image format. */
  name?: string
  category?: string
  /** `auto` | `single` | `pair` | `multiple`. */
  itemConfiguration?: string
  anchor?: string
  /** Requires an enabled 3D provider on the server; refused 3D is reported, not fabricated. */
  generate3d?: boolean
}

export async function createAssetJob(input: CreateAssetJobInput): Promise<AssetJob> {
  const body = new FormData()
  // The file goes last: a multipart parser that streams fields in order sees every string field
  // before it starts on the payload.
  if (input.name) body.append('name', input.name)
  if (input.category) body.append('category', input.category)
  if (input.itemConfiguration) body.append('item_configuration', input.itemConfiguration)
  if (input.anchor) body.append('anchor', input.anchor)
  if (input.generate3d) body.append('generate_3d', 'true')
  body.append('file', input.file)

  // No Content-Type header: the browser must set it, because only it knows the multipart boundary.
  const created = asRecord(await send('/api/jobs', { method: 'POST', body }), 'job')
  const id = str(created.id)
  if (!id) {
    throw new ServiceError(
      'unknown',
      'The asset service accepted the upload but did not return a job to follow.',
    )
  }

  // The create response is deliberately small — id, state and a status URL. Reading the job back
  // once costs a round trip and means the screen renders real stages immediately instead of an
  // empty list that fills in a second later.
  return fetchAssetJob(id)
}

export async function fetchAssetJob(jobId: string, signal?: AbortSignal): Promise<AssetJob> {
  return parseJob(await send(`/api/jobs/${encodeURIComponent(jobId)}`, { signal }))
}

export async function approveAssetJob(jobId: string, assetIds: string[]): Promise<AssetJob> {
  return parseJob(
    await send(`/api/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_ids: assetIds }),
    }),
  )
}

export async function rejectAssetJob(jobId: string, reason: string): Promise<AssetJob> {
  return parseJob(
    await send(`/api/jobs/${encodeURIComponent(jobId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  )
}

export async function retryAssetJob(jobId: string): Promise<AssetJob> {
  return parseJob(await send(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }))
}

export async function deleteAssetJob(jobId: string): Promise<void> {
  await send(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
}

/* ── Presentation helpers (pure) ────────────────────────────────────────── */

/**
 * Plain-English names for the pipeline's stages.
 *
 * The server's own stage keys are deliberately not shown: `generating_2d` is an implementation
 * word, and a seller reading a progress list is asking "what is it doing to my photograph".
 */
export const STAGE_LABELS: Record<string, string> = {
  validating: 'Checking the image',
  preprocessing: 'Preparing the image',
  segmenting: 'Separating the piece from the background',
  generating_2d: 'Building the try-on image',
  generating_3d: 'Building the 3D file',
  validating_assets: 'Verifying the result',
}

export const STAGE_STATE_LABELS: Record<AssetStageState, string> = {
  pending: 'Waiting',
  running: 'Working',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

/** The item roles the backend uses, in the words a seller would recognise. */
export const ROLE_LABELS: Record<string, string> = {
  primary: 'The piece',
  left: 'Left earring',
  right: 'Right earring',
  item_1: 'Item 1',
  item_2: 'Item 2',
  item_3: 'Item 3',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** The cutouts a seller can choose from, in the order the server reported them. */
export function cutoutsOf(job: AssetJob): DerivedAsset[] {
  return job.assets.filter((asset) => asset.kind === 'cutout_2d')
}

export function modelsOf(job: AssetJob): DerivedAsset[] {
  return job.assets.filter((asset) => asset.kind === 'model_3d')
}
