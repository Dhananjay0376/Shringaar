import { describe, expect, it } from 'vitest'

import { inspectGlbBytes } from '../assets/validate'

/**
 * A GLB assembled by hand, so every failure below is produced on purpose rather than hoped for.
 *
 * Nothing here reads a checked-in binary. A real `.glb` could only ever exercise the happy path, and
 * the branches that matter — truncated, wrong magic, version 1, a JSON chunk with no meshes — are
 * exactly the ones a real file cannot be. Building the container from its specification means each
 * field can be corrupted one at a time, which is what makes "a distinct reason per failure" a claim
 * this file can actually test.
 */

const MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

interface GlbOptions {
  readonly magic?: number
  readonly version?: number
  /** What the header's length field claims. Defaults to the true length. */
  readonly declaredLength?: number
  /** The JSON chunk's text. `null` omits the chunk entirely. */
  readonly json?: string | null
  /** The chunk type recorded for chunk 0. */
  readonly chunkType?: number
  /** The length recorded for chunk 0, when it should disagree with the data written. */
  readonly chunkLength?: number
}

function buildGlb(options: GlbOptions = {}): Uint8Array {
  const json = options.json === undefined ? JSON.stringify({ meshes: [{ primitives: [] }] }) : options.json

  // The spec pads JSON chunks with spaces to a 4-byte boundary; JSON.parse ignores trailing space.
  const raw = json === null ? new Uint8Array(0) : new TextEncoder().encode(json)
  const padded = new Uint8Array(Math.ceil(raw.length / 4) * 4).fill(0x20)
  padded.set(raw)

  const chunkBytes = json === null ? 0 : 8 + padded.length
  const length = 12 + chunkBytes

  const buffer = new Uint8Array(length)
  const view = new DataView(buffer.buffer)

  view.setUint32(0, options.magic ?? MAGIC, true)
  view.setUint32(4, options.version ?? 2, true)
  view.setUint32(8, options.declaredLength ?? length, true)

  if (json !== null) {
    view.setUint32(12, options.chunkLength ?? padded.length, true)
    view.setUint32(16, options.chunkType ?? CHUNK_JSON, true)
    buffer.set(padded, 20)
  }

  return buffer
}

describe('inspectGlbBytes — accepting a real model', () => {
  it('accepts a minimal well-formed GLB', () => {
    expect(inspectGlbBytes(buildGlb())).toEqual({ status: 'valid' })
  })

  it('reads a view into a larger buffer at the right offset', () => {
    /* A `Uint8Array` sliced out of a bigger read is the normal shape coming off a file reader, and a
       DataView built without `byteOffset` would read the surrounding bytes and reject a good file. */
    const glb = buildGlb()
    const padded = new Uint8Array(glb.length + 16)
    padded.set(glb, 9)

    expect(inspectGlbBytes(padded.subarray(9, 9 + glb.length))).toEqual({ status: 'valid' })
  })
})

describe('inspectGlbBytes — the container', () => {
  it('rejects a file too small to hold a header, and says how small', () => {
    const result = inspectGlbBytes(new Uint8Array([0x67, 0x6c, 0x54]))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('has 3')
  })

  it('rejects a file whose signature is not glTF', () => {
    const result = inspectGlbBytes(buildGlb({ magic: 0x89504e47 })) // a PNG
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('glTF')
  })

  it('rejects glTF version 1, naming the version it found', () => {
    const result = inspectGlbBytes(buildGlb({ version: 1 }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('version 1')
  })

  it('rejects a file the header says is longer than what arrived', () => {
    /* The shape of a download cut short: a good header promising bytes that never came. */
    const glb = buildGlb()
    const result = inspectGlbBytes(buildGlb({ declaredLength: glb.length + 4096 }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('incomplete')
  })

  it('rejects a declared length too small to hold a chunk', () => {
    const result = inspectGlbBytes(buildGlb({ declaredLength: 14 }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('too few to hold')
  })

  it('rejects a first chunk that is not JSON', () => {
    const result = inspectGlbBytes(buildGlb({ chunkType: CHUNK_BIN }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('JSON')
  })

  it('rejects a JSON chunk that claims more bytes than the file holds', () => {
    const result = inspectGlbBytes(buildGlb({ chunkLength: 4096 }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('4096')
  })

  it('rejects a chunk that overruns the length the header declared', () => {
    /* The bytes are all present, so a loader trusting only the real file size would read this happily.
       The header's own figure is what a conforming loader believes, so it is checked too — and 24
       bytes is deliberately enough to pass the "too small for a chunk" test at 20, so this fails on
       the overrun and nothing else. */
    const result = inspectGlbBytes(buildGlb({ declaredLength: 24 }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('does not contain that many')
  })
})

describe('inspectGlbBytes — the model', () => {
  it('rejects a JSON chunk that does not parse', () => {
    const result = inspectGlbBytes(buildGlb({ json: '{ "meshes": [ }' }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('parsed')
  })

  it('rejects a JSON chunk that is not an object', () => {
    const result = inspectGlbBytes(buildGlb({ json: '[1, 2, 3]' }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('object')
  })

  /* A valid file describing nothing. Passing it on yields an empty scene, which on screen is
     indistinguishable from a renderer that failed — the single most confusing outcome available. */
  it('rejects a model with no meshes', () => {
    const result = inspectGlbBytes(buildGlb({ json: JSON.stringify({ asset: { version: '2.0' } }) }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('no meshes')
  })

  it('rejects a model whose meshes field is present but empty', () => {
    const result = inspectGlbBytes(buildGlb({ json: JSON.stringify({ meshes: [] }) }))
    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reason).toContain('no meshes')
  })

  it('rejects a model whose meshes field is not an array', () => {
    const result = inspectGlbBytes(buildGlb({ json: JSON.stringify({ meshes: 'yes' }) }))
    expect(result.status).toBe('invalid')
  })
})

describe('inspectGlbBytes — the reasons are usable', () => {
  /* Each failure gets its own sentence, because they call for different actions: a truncated file is a
     transfer problem, an empty scene is a modelling one. Two failures sharing a message would send a
     seller to fix the wrong thing, and a test matching on prose alone would not notice. */
  it('gives every distinct failure a distinct reason', () => {
    const reasons = [
      buildGlb({ magic: 0x89504e47 }),
      buildGlb({ version: 1 }),
      buildGlb({ declaredLength: 14 }),
      buildGlb({ chunkType: CHUNK_BIN }),
      buildGlb({ chunkLength: 4096 }),
      buildGlb({ json: '{ "meshes": [ }' }),
      buildGlb({ json: JSON.stringify({ meshes: [] }) }),
    ].map((bytes) => {
      const result = inspectGlbBytes(bytes)
      if (result.status !== 'invalid') throw new Error('expected every case here to fail')
      return result.reason
    })

    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it('never reports a non-empty reason and a valid status at once', () => {
    const result = inspectGlbBytes(buildGlb())
    expect(result).toEqual({ status: 'valid' })
  })
})
