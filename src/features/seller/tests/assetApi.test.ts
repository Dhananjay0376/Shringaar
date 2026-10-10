import { afterEach, describe, expect, it, vi } from 'vitest'

import { config } from '@/lib/config'
import { isServiceError } from '@/lib/seller'
import {
  approveAssetJob,
  createAssetJob,
  cutoutsOf,
  deleteAssetJob,
  fetchAssetJob,
  isAssetApiConfigured,
  isJobSettled,
  modelsOf,
  parseJob,
  rejectAssetJob,
  roleLabel,
} from '../services/assetApi'
import type { AssetJobState } from '../services/assetApi'

/**
 * The asset service client, tested where it can be tested without a browser: the payload reader and
 * the transport.
 *
 * These two halves fail in opposite directions and both are worth pinning. The reader fails *quietly*
 * — an unread field renders as `undefined` in a table cell and looks like a dashboard bug rather than
 * a contract mismatch. The transport fails *loudly but wrongly* — a refusal reported as "unreachable",
 * or the service's own sentence about a 14 MB image replaced by "Upload failed", which sends the
 * seller looking for a network problem instead of a smaller export.
 */

/* ── Harness ──────────────────────────────────────────────────────────────── */

const originalAssetApiUrl = config.assetApiUrl

/**
 * A `Response` stand-in. Only the three members the client reads are present, which is deliberate:
 * if the client ever starts reading a fourth, this file fails rather than silently passing.
 */
function respond(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

interface Call {
  url: string
  init: RequestInit | undefined
}

/** Queue one response per call. The last response repeats if the client asks more than expected. */
function stubFetch(...bodies: unknown[]): Call[] {
  const calls: Call[] = []
  let index = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const body = bodies[Math.min(index, bodies.length - 1)]
      index += 1
      return respond(body)
    }),
  )

  return calls
}

function stubStatus(status: number, body: unknown): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return respond(body, status)
    }),
  )
  return calls
}

/** A job payload as the service actually writes it: snake_case on the wire, camelCase in the app. */
function jobPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    state: 'awaiting_review',
    progress: 1,
    simulated: true,
    stages: [
      {
        stage: 'validating',
        state: 'succeeded',
        message: null,
        duration_ms: 12,
      },
    ],
    assets: [
      {
        id: 'asset-1',
        kind: 'cutout_2d',
        role: 'left',
        url: 'http://service.test/files/job-1/cutout-left.png',
        mime_type: 'image/png',
        width: 520,
        height: 360,
        size_bytes: 4096,
        simulated: true,
        approved: false,
      },
    ],
    detection: {
      item_count: 2,
      resolved_configuration: 'pair',
      needs_seller_confirmation: false,
      explanation: 'Found a matching pair.',
    },
    error: null,
    notes: ['This cut-out was produced by a stand-in, not by a model.'],
    ...overrides,
  }
}

afterEach(() => {
  config.assetApiUrl = originalAssetApiUrl
  vi.unstubAllGlobals()
})

/* ── Configuration gate ───────────────────────────────────────────────────── */

describe('configuration', () => {
  it('reports unconfigured when no service URL is set', () => {
    config.assetApiUrl = null
    expect(isAssetApiConfigured()).toBe(false)
  })

  it('reports configured when one is', () => {
    config.assetApiUrl = 'http://service.test'
    expect(isAssetApiConfigured()).toBe(true)
  })

  it('refuses to send anything when no service is configured, without trying', async () => {
    // The failure this prevents is a request to the literal string `undefined/api/jobs`, which
    // surfaces as a CORS error and sends the reader hunting in the wrong layer entirely.
    config.assetApiUrl = null
    const calls = stubFetch(jobPayload())

    await expect(fetchAssetJob('job-1')).rejects.toSatisfy(
      (cause: unknown) => isServiceError(cause) && cause.code === 'not_implemented',
    )
    expect(calls).toHaveLength(0)
  })
})

/* ── Payload reading ──────────────────────────────────────────────────────── */

describe('parseJob', () => {
  it('reads the whole payload and renames every field it carries', () => {
    const job = parseJob(jobPayload())

    expect(job.id).toBe('job-1')
    expect(job.state).toBe('awaiting_review')
    expect(job.progress).toBe(1)
    expect(job.simulated).toBe(true)

    expect(job.stages).toEqual([
      { stage: 'validating', state: 'succeeded', message: null, durationMs: 12 },
    ])
    expect(job.assets[0]).toEqual({
      id: 'asset-1',
      kind: 'cutout_2d',
      role: 'left',
      url: 'http://service.test/files/job-1/cutout-left.png',
      mimeType: 'image/png',
      width: 520,
      height: 360,
      sizeBytes: 4096,
      simulated: true,
      approved: false,
    })
    expect(job.detection).toEqual({
      itemCount: 2,
      resolvedConfiguration: 'pair',
      needsSellerConfirmation: false,
      explanation: 'Found a matching pair.',
    })
    expect(job.notes).toEqual(['This cut-out was produced by a stand-in, not by a model.'])
  })

  it('refuses a payload with no id rather than returning a job nothing can address', () => {
    expect(() => parseJob({ state: 'queued' })).toThrowError(/no id/)
    expect(() => parseJob({ id: '' })).toThrowError(/no id/)
  })

  it('refuses a payload that is not an object', () => {
    expect(() => parseJob(null)).toThrowError(/unexpected job/)
    expect(() => parseJob([{ id: 'job-1' }])).toThrowError(/unexpected job/)
    expect(() => parseJob('job-1')).toThrowError(/unexpected job/)
  })

  it('refuses an asset kind it cannot render, instead of guessing at the mapping', () => {
    expect(() =>
      parseJob(jobPayload({ assets: [{ id: 'a', kind: 'sprite_9d' }] })),
    ).toThrowError(/unknown asset kind/)
  })

  it('reads a missing state as failed, so an unreadable job never looks like a working one', () => {
    // Defaulting to a *working* state would leave the review screen polling forever with nothing to
    // poll for. The pessimistic default is the honest one.
    const job = parseJob({ id: 'job-1' })
    expect(job.state).toBe('failed')
    expect(job.progress).toBe(0)
    expect(job.simulated).toBe(false)
    expect(job.stages).toEqual([])
    expect(job.assets).toEqual([])
    expect(job.detection).toBeNull()
    expect(job.error).toBeNull()
    expect(job.notes).toEqual([])
  })

  it('treats a stage state it does not know as pending', () => {
    const job = parseJob(jobPayload({ stages: [{ stage: 'validating' }] }))
    expect(job.stages[0]?.state).toBe('pending')
    expect(job.stages[0]?.message).toBeNull()
    expect(job.stages[0]?.durationMs).toBeNull()
  })

  it('reads retryable as strictly boolean true', () => {
    // The field gates a button. A truthy string arriving from a version mismatch would offer a
    // retry the service had already said would fail.
    const withString = parseJob(
      jobPayload({ error: { code: 'corrupt_image', stage: 'validating', message: 'x', retryable: 'yes' } }),
    )
    expect(withString.error?.retryable).toBe(false)

    const withTrue = parseJob(
      jobPayload({ error: { code: 'provider_error', stage: 'segmenting', message: 'x', retryable: true } }),
    )
    expect(withTrue.error).toEqual({
      code: 'provider_error',
      stage: 'segmenting',
      message: 'x',
      retryable: true,
    })
  })

  it('falls back to a seller-readable message when the service sent none', () => {
    const job = parseJob(jobPayload({ error: { code: 'unknown', stage: 'segmenting' } }))
    expect(job.error?.message).toBe('Processing failed.')
  })

  it('degrades a list of the wrong shape to an empty list rather than throwing', () => {
    // Nothing renders from a malformed list, so there is nothing to get wrong — unlike an unknown
    // asset kind above, which would have to be drawn.
    const job = parseJob(jobPayload({ assets: 'none', stages: 3, notes: null }))
    expect(job.assets).toEqual([])
    expect(job.stages).toEqual([])
    expect(job.notes).toEqual([])
  })

  it('does not carry a simulated flag it was not told about', () => {
    expect(parseJob(jobPayload({ simulated: undefined })).simulated).toBe(false)
  })
})

/* ── Polling decision ─────────────────────────────────────────────────────── */

describe('isJobSettled', () => {
  /**
   * Written as a total map rather than two sampled lists on purpose: `Record<AssetJobState, boolean>`
   * is exhaustive at compile time, so adding a state to the union without deciding whether polling
   * should continue through it fails `tsc --noEmit` rather than polling forever in production.
   */
  const EXPECTED: Record<AssetJobState, boolean> = {
    uploaded: false,
    queued: false,
    validating: false,
    preprocessing: false,
    segmenting: false,
    generating_2d: false,
    generating_3d: false,
    validating_assets: false,
    awaiting_review: true,
    approved: true,
    rejected: true,
    failed: true,
  }

  it.each(Object.entries(EXPECTED))('reports %s as settled=%s', (state, settled) => {
    expect(isJobSettled(state as AssetJobState)).toBe(settled)
  })
})

/* ── Transport ────────────────────────────────────────────────────────────── */

describe('transport', () => {
  it('prefers the service’s own sentence to one of its own', async () => {
    config.assetApiUrl = 'http://service.test'
    stubStatus(400, { detail: 'This image is 14.2 MB. The limit is 12 MB.' })

    await expect(fetchAssetJob('job-1')).rejects.toSatisfy(
      (cause: unknown) =>
        isServiceError(cause) &&
        cause.code === 'validation' &&
        cause.message === 'This image is 14.2 MB. The limit is 12 MB.',
    )
  })

  it.each([
    [400, 'validation'],
    [404, 'not_found'],
    [409, 'conflict'],
    [500, 'unknown'],
    [503, 'unknown'],
  ])('maps %i to %s', async (status, code) => {
    config.assetApiUrl = 'http://service.test'
    stubStatus(status, { detail: '' })

    await expect(fetchAssetJob('job-1')).rejects.toSatisfy(
      (cause: unknown) => isServiceError(cause) && cause.code === code,
    )
  })

  it('falls back to the status when the error body is not JSON', async () => {
    config.assetApiUrl = 'http://service.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      })) as unknown as typeof fetch,
    )

    await expect(fetchAssetJob('job-1')).rejects.toSatisfy(
      (cause: unknown) =>
        isServiceError(cause) && cause.code === 'unknown' && cause.message.includes('502'),
    )
  })

  it('separates an unreachable service from a refusal', async () => {
    // The two call for different words on screen: one is "start the service", the other is "change
    // the photograph". Collapsing them sends the seller to the wrong fix.
    config.assetApiUrl = 'http://service.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    )

    await expect(fetchAssetJob('job-1')).rejects.toSatisfy(
      (cause: unknown) =>
        isServiceError(cause) &&
        cause.message.includes('could not be reached') &&
        cause.message.includes('Failed to fetch'),
    )
  })

  it('builds the request URL from the configured base', async () => {
    config.assetApiUrl = 'http://service.test:8123'
    const calls = stubFetch(jobPayload())
    await fetchAssetJob('job-1')
    expect(calls[0]?.url).toBe('http://service.test:8123/api/jobs/job-1')
  })

  it('escapes the job id rather than pasting it into the path', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch(jobPayload())
    await fetchAssetJob('../../etc/passwd')
    expect(calls[0]?.url).toBe('http://service.test/api/jobs/..%2F..%2Fetc%2Fpasswd')
  })

  it('reads the job back after creating it, so the first render has real stages', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch({ id: 'job-1', state: 'queued', status_url: '/api/jobs/job-1' }, jobPayload())

    const job = await createAssetJob({ file: new File(['x'], 'photo.png'), anchor: 'ear' })

    expect(job.stages).toHaveLength(1)
    expect(job.state).toBe('awaiting_review')
    expect(calls.map((call) => call.url)).toEqual([
      'http://service.test/api/jobs',
      'http://service.test/api/jobs/job-1',
    ])
    expect(calls[1]?.init?.method).toBeUndefined()
  })

  it('refuses a create response with no job to follow', async () => {
    config.assetApiUrl = 'http://service.test'
    stubFetch({ state: 'queued' })

    await expect(createAssetJob({ file: new File(['x'], 'photo.png') })).rejects.toSatisfy(
      (cause: unknown) =>
        isServiceError(cause) && cause.message.includes('did not return a job to follow'),
    )
  })

  it('sends multipart with the file last and no Content-Type of its own', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch({ id: 'job-1' }, jobPayload())

    await createAssetJob({
      file: new File(['x'], 'photo.png'),
      name: 'Gold jhumka',
      category: 'earrings',
      itemConfiguration: 'pair',
      anchor: 'ear',
      generate3d: true,
    })

    const create = calls[0]
    expect(create?.init?.method).toBe('POST')
    // Only the browser knows the multipart boundary; setting this header by hand produces a body the
    // server cannot parse.
    expect(create?.init?.headers).toBeUndefined()

    const body = create?.init?.body
    if (!(body instanceof FormData)) throw new Error('expected a multipart body')
    expect(Array.from(body.keys())).toEqual([
      'name',
      'category',
      'item_configuration',
      'anchor',
      'generate_3d',
      'file',
    ])
    expect(body.get('generate_3d')).toBe('true')
  })

  it('omits the optional fields it was not given', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch({ id: 'job-1' }, jobPayload())

    await createAssetJob({ file: new File(['x'], 'photo.png') })

    const body = calls[0]?.init?.body
    if (!(body instanceof FormData)) throw new Error('expected a multipart body')
    expect(Array.from(body.keys())).toEqual(['file'])
  })

  it('sends false for generate_3d by leaving it out, never as the string "false"', async () => {
    // The server reads the field's presence. `generate_3d=false` would read as a request for 3D.
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch({ id: 'job-1' }, jobPayload())

    await createAssetJob({ file: new File(['x'], 'photo.png'), generate3d: false })

    const body = calls[0]?.init?.body
    if (!(body instanceof FormData)) throw new Error('expected a multipart body')
    expect(body.has('generate_3d')).toBe(false)
  })

  it('posts the approved asset ids as JSON', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch(jobPayload({ state: 'approved' }))

    await approveAssetJob('job-1', ['asset-1', 'asset-2'])

    const call = calls[0]
    expect(call?.url).toBe('http://service.test/api/jobs/job-1/approve')
    expect(call?.init?.method).toBe('POST')
    expect(call?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(call?.init?.body))).toEqual({ asset_ids: ['asset-1', 'asset-2'] })
  })

  it('posts a rejection reason', async () => {
    config.assetApiUrl = 'http://service.test'
    const calls = stubFetch(jobPayload({ state: 'rejected' }))

    await rejectAssetJob('job-1', 'Not the right piece.')

    expect(calls[0]?.url).toBe('http://service.test/api/jobs/job-1/reject')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ reason: 'Not the right piece.' })
  })

  it('reads an empty delete response without trying to parse it', async () => {
    config.assetApiUrl = 'http://service.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError('no body')
        },
      })) as unknown as typeof fetch,
    )

    await expect(deleteAssetJob('job-1')).resolves.toBeUndefined()
  })
})

/* ── Presentation helpers ─────────────────────────────────────────────────── */

describe('presentation helpers', () => {
  it('names the roles a seller would recognise', () => {
    expect(roleLabel('left')).toBe('Left earring')
    expect(roleLabel('right')).toBe('Right earring')
    expect(roleLabel('primary')).toBe('The piece')
  })

  it('passes through a role it has no name for, rather than showing nothing', () => {
    // An unrecognised role must still be visible: a label reading `item_4` is odd, a blank one is a
    // broken screen.
    expect(roleLabel('item_4')).toBe('item_4')
  })

  it('separates the cut-outs from the 3D files', () => {
    const job = parseJob(
      jobPayload({
        assets: [
          { id: 'a', kind: 'cutout_2d', role: 'left', url: 'u' },
          { id: 'b', kind: 'model_3d', role: 'left', url: 'u' },
          { id: 'c', kind: 'cutout_2d', role: 'right', url: 'u' },
        ],
      }),
    )

    expect(cutoutsOf(job).map((asset) => asset.id)).toEqual(['a', 'c'])
    expect(modelsOf(job).map((asset) => asset.id)).toEqual(['b'])
  })
})
