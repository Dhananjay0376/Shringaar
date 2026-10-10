import { describe, expect, it } from 'vitest'

import {
  CALIBRATION_BOUNDS,
  CALIBRATION_STORAGE_KEY,
  NEUTRAL_CALIBRATION,
  clampCalibration,
  decodeCalibration,
  encodeCalibration,
  loadCalibration,
  saveCalibration,
  type CalibrationStore,
} from '../core/calibration'

/** A `localStorage` stand-in whose failures can be switched on. */
function fakeStore(options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): CalibrationStore & {
  readonly data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    getItem(key) {
      if (options.throwOnGet) throw new Error('storage is blocked')
      return data.get(key) ?? null
    },
    setItem(key, value) {
      if (options.throwOnSet) throw new Error('quota exceeded')
      data.set(key, value)
    },
  }
}

describe('clampCalibration', () => {
  it('bounds every field to its limits', () => {
    const clamped = clampCalibration({
      size: 99,
      outward: -99,
      drop: 99,
      tilt: -99,
    })

    expect(clamped.size).toBe(CALIBRATION_BOUNDS.size.max)
    expect(clamped.outward).toBe(CALIBRATION_BOUNDS.outward.min)
    expect(clamped.drop).toBe(CALIBRATION_BOUNDS.drop.max)
    expect(clamped.tilt).toBe(CALIBRATION_BOUNDS.tilt.min)
  })

  it('passes through values already in range', () => {
    const calibration = { size: 1.3, outward: 0.2, drop: -0.1, tilt: 0.05 }
    expect(clampCalibration(calibration)).toEqual(calibration)
  })

  it('fills absent fields from neutral', () => {
    expect(clampCalibration({ size: 1.2 })).toEqual({ ...NEUTRAL_CALIBRATION, size: 1.2 })
    expect(clampCalibration(null)).toEqual(NEUTRAL_CALIBRATION)
    expect(clampCalibration(undefined)).toEqual(NEUTRAL_CALIBRATION)
  })

  /* NaN is the dangerous one: `clamp(NaN, a, b)` returns NaN by every comparison being false, so a
     plain `clamp` would let it straight through into the renderer transform. */
  it('rejects NaN, Infinity and wrong types rather than propagating them', () => {
    const clamped = clampCalibration({
      size: Number.NaN,
      outward: Number.POSITIVE_INFINITY,
      drop: Number.NEGATIVE_INFINITY,
      tilt: '0.3' as unknown as number,
    })

    expect(clamped).toEqual(NEUTRAL_CALIBRATION)
  })
})

describe('encode and decode', () => {
  it('round-trips to deep equality', () => {
    const calibration = { size: 1.4, outward: -0.25, drop: 0.3, tilt: 0.1 }
    expect(decodeCalibration(encodeCalibration(calibration))).toEqual(calibration)
  })

  it('clamps on the way out, so an out-of-range value cannot be stored', () => {
    const encoded = encodeCalibration({ size: 99, outward: 0, drop: 0, tilt: 0 })
    expect(JSON.parse(encoded)).toMatchObject({ size: CALIBRATION_BOUNDS.size.max })
  })

  it('encodes with a stable key order, so equal calibrations produce identical strings', () => {
    const a = encodeCalibration({ size: 1.1, outward: 0.1, drop: 0.2, tilt: 0.3 })
    const b = encodeCalibration({ tilt: 0.3, drop: 0.2, outward: 0.1, size: 1.1 })
    expect(a).toBe(b)
  })
})

describe('decodeCalibration — corrupt input', () => {
  it('returns neutral for null and empty', () => {
    expect(decodeCalibration(null)).toEqual(NEUTRAL_CALIBRATION)
    expect(decodeCalibration(undefined)).toEqual(NEUTRAL_CALIBRATION)
    expect(decodeCalibration('')).toEqual(NEUTRAL_CALIBRATION)
  })

  it('returns neutral for unparsable JSON instead of throwing', () => {
    expect(decodeCalibration('{not json')).toEqual(NEUTRAL_CALIBRATION)
    expect(decodeCalibration('garbage')).toEqual(NEUTRAL_CALIBRATION)
  })

  it('returns neutral for JSON that parses but is the wrong shape', () => {
    expect(decodeCalibration('null')).toEqual(NEUTRAL_CALIBRATION)
    expect(decodeCalibration('42')).toEqual(NEUTRAL_CALIBRATION)
    expect(decodeCalibration('"a string"')).toEqual(NEUTRAL_CALIBRATION)
    /* An array is an object, so it passes a naive `typeof` check and would index into `size` as
       undefined — which is why it is rejected explicitly. */
    expect(decodeCalibration('[1, 2, 3]')).toEqual(NEUTRAL_CALIBRATION)
  })

  it('salvages the readable fields from a partially corrupt record', () => {
    const decoded = decodeCalibration('{"size": 1.5, "outward": "nonsense"}')
    expect(decoded.size).toBe(1.5)
    expect(decoded.outward).toBe(NEUTRAL_CALIBRATION.outward)
  })
})

describe('loadCalibration and saveCalibration', () => {
  it('round-trips through storage', () => {
    const store = fakeStore()
    const calibration = { size: 1.25, outward: 0.15, drop: -0.2, tilt: 0.05 }

    expect(saveCalibration(store, calibration)).toBe(true)
    expect(loadCalibration(store)).toEqual(calibration)
    expect(store.data.has(CALIBRATION_STORAGE_KEY)).toBe(true)
  })

  it('returns neutral when nothing has been saved', () => {
    expect(loadCalibration(fakeStore())).toEqual(NEUTRAL_CALIBRATION)
  })

  /* A blocked or full store is a convenience problem, never a page-breaking one. */
  it('degrades to neutral when the store throws on read', () => {
    expect(loadCalibration(fakeStore({ throwOnGet: true }))).toEqual(NEUTRAL_CALIBRATION)
  })

  it('reports failure rather than throwing when the store refuses the write', () => {
    expect(saveCalibration(fakeStore({ throwOnSet: true }), NEUTRAL_CALIBRATION)).toBe(false)
  })

  it('treats a missing store as neutral, not as an error', () => {
    expect(loadCalibration(null)).toEqual(NEUTRAL_CALIBRATION)
    expect(saveCalibration(null, NEUTRAL_CALIBRATION)).toBe(false)
  })
})
