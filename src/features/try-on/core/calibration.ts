/**
 * Per-face calibration.
 *
 * The ear anchor is derived from face-oval landmarks, and the nearest of those sits on the
 * cheek/jaw contour rather than on the lobe — the model has no lobe landmark at all. So there is a
 * small systematic offset, and its size varies with face shape. These four numbers are how a
 * customer corrects it for their own face without anyone having to pretend the default is right for
 * everyone.
 *
 * Every value is a *relative* adjustment, never a pixel count, so a calibration survives a window
 * resize, a different camera resolution and a different device. `size` and the three offsets are all
 * expressed against the interocular distance, which is the one measurement the solver already
 * trusts.
 *
 * Storage is best-effort throughout. A calibration is a convenience; a blocked `localStorage` in a
 * private window must degrade to "you'll retune next time", never to a thrown exception on a
 * product page.
 */

import { clamp } from './geometry'

export interface Calibration {
  /** Multiplier on the drawn width. 1 is the derived default. */
  readonly size: number
  /** Added to the outward step, in interocular units. Positive pushes away from the face. */
  readonly outward: number
  /** Added to the downward step, in interocular units. Positive drops the earring. */
  readonly drop: number
  /**
   * Differential drop, in interocular units. Positive lowers one side and raises the other, which
   * is how a face whose ears sit at different heights is corrected with a single control.
   */
  readonly tilt: number
}

export const NEUTRAL_CALIBRATION: Calibration = { size: 1, outward: 0, drop: 0, tilt: 0 }

/**
 * Bounds chosen so every extreme is still a recognisable earring.
 *
 * A slider that can be dragged to a state where nothing is on screen is a slider the customer will
 * not be able to drag back. These stops keep the worst case wrong-but-visible.
 */
export const CALIBRATION_BOUNDS = {
  size: { min: 0.4, max: 2.5 },
  outward: { min: -0.8, max: 0.8 },
  drop: { min: -0.8, max: 0.8 },
  tilt: { min: -0.6, max: 0.6 },
} as const

export const CALIBRATION_STORAGE_KEY = 'shringaar.tryon.calibration.v1'

/** The part of `Storage` this module needs, so a fake is three lines in a test. */
export interface CalibrationStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function safeField(value: unknown, fallback: number, min: number, max: number): number {
  /* `typeof value === 'number'` is not enough: NaN is a number, and `clamp(NaN, a, b)` returns NaN
     by every comparison being false, which would put a NaN into the renderer. */
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return clamp(value, min, max)
}

/** The neutral calibration with every field bounded. */
export function neutralCalibration(): Calibration {
  return NEUTRAL_CALIBRATION
}

/**
 * Bounds every field and fills in anything absent.
 *
 * Accepts a partial because the caller is usually decoded JSON from an older version, a hand-edited
 * value, or a form state that has not filled every slider yet.
 */
export function clampCalibration(input: Partial<Calibration> | null | undefined): Calibration {
  const source = input ?? {}
  return {
    size: safeField(source.size, NEUTRAL_CALIBRATION.size, CALIBRATION_BOUNDS.size.min, CALIBRATION_BOUNDS.size.max),
    outward: safeField(
      source.outward,
      NEUTRAL_CALIBRATION.outward,
      CALIBRATION_BOUNDS.outward.min,
      CALIBRATION_BOUNDS.outward.max,
    ),
    drop: safeField(source.drop, NEUTRAL_CALIBRATION.drop, CALIBRATION_BOUNDS.drop.min, CALIBRATION_BOUNDS.drop.max),
    tilt: safeField(source.tilt, NEUTRAL_CALIBRATION.tilt, CALIBRATION_BOUNDS.tilt.min, CALIBRATION_BOUNDS.tilt.max),
  }
}

/**
 * Serialises with a fixed key order.
 *
 * `JSON.stringify` follows insertion order, so building the object literal in one place means two
 * calibrations that are equal always encode to the same string. That matters only for the tests, and
 * it is the reason they are written against a value rather than a snapshot, but it costs nothing to
 * make deterministic.
 */
export function encodeCalibration(calibration: Calibration): string {
  const bounded = clampCalibration(calibration)
  return JSON.stringify({
    size: bounded.size,
    outward: bounded.outward,
    drop: bounded.drop,
    tilt: bounded.tilt,
  })
}

/** Never throws. Anything unreadable is neutral, which is a working earring. */
export function decodeCalibration(raw: string | null | undefined): Calibration {
  if (!raw) return neutralCalibration()

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return neutralCalibration()
    }
    return clampCalibration(parsed as Partial<Calibration>)
  } catch {
    return neutralCalibration()
  }
}

/** Reads and decodes, tolerating a store that throws on access (blocked storage, private mode). */
export function loadCalibration(store: CalibrationStore | null | undefined): Calibration {
  if (!store) return neutralCalibration()
  try {
    return decodeCalibration(store.getItem(CALIBRATION_STORAGE_KEY))
  } catch {
    return neutralCalibration()
  }
}

/** Returns whether the write landed, so the UI can say "you'll retune next time" if it did not. */
export function saveCalibration(
  store: CalibrationStore | null | undefined,
  calibration: Calibration,
): boolean {
  if (!store) return false
  try {
    store.setItem(CALIBRATION_STORAGE_KEY, encodeCalibration(calibration))
    return true
  } catch {
    return false
  }
}

/** The browser's store, or null where there is none. Never throws. */
export function browserCalibrationStore(): CalibrationStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
