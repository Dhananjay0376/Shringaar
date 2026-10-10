import { describe, expect, it } from 'vitest'

import {
  EAR_GEOMETRY,
  YAW_FADE_END,
  YAW_FADE_START,
  earOpacityForYaw,
  solveEarrings,
} from '../anchors/earring'
import { NEUTRAL_CALIBRATION, type Calibration } from '../core/calibration'
import { MIN_DRAW_OPACITY, type PlacementTarget } from '../types/frame'
import { syntheticFaceFrame } from './helpers/syntheticFace'

const NEUTRAL: Calibration = NEUTRAL_CALIBRATION
const CENTRE_X = 320

/* The fixture's own defaults, restated here so the expectations below are arithmetic rather than
   magic numbers. Restated and not imported on purpose: a test that reads its expectations out of the
   helper it is testing cannot notice the helper changing underneath it. */
const CENTRE_Y = 240
const CLUSTER_Y = 0.1875
const INTEROCULAR = 128

function solve(options: Parameters<typeof syntheticFaceFrame>[0] = {}, calibration = NEUTRAL): PlacementTarget[] {
  return solveEarrings(syntheticFaceFrame(options), calibration)
}

function bySide(targets: readonly PlacementTarget[], side: 'left' | 'right'): PlacementTarget {
  const found = targets.find((t) => t.side === side)
  if (!found) throw new Error(`no ${side} target`)
  return found
}

describe('solveEarrings — a symmetric, frontal face', () => {
  it('produces exactly two targets', () => {
    expect(solve()).toHaveLength(2)
  })

  it('places them symmetrically about the face centre', () => {
    const targets = solve()
    const left = bySide(targets, 'left')
    const right = bySide(targets, 'right')

    expect(left.x + right.x).toBeCloseTo(2 * CENTRE_X, 6)
    expect(left.y).toBeCloseTo(right.y, 6)
  })

  it('sizes both from the same interocular measurement', () => {
    const [left, right] = solve()
    expect(left?.width).toBeCloseTo(right?.width ?? 0, 9)
    expect(left?.width).toBeCloseTo(128 * EAR_GEOMETRY.assetScale, 6)
  })

  /* The claim the whole design rests on: the anchor is extrapolated *beyond* the contour, because
     the mesh's cheek point is not where an ear is. If this ever fails the earring would be drawn on
     the cheek, which is the single most visible way for this feature to be wrong. */
  it('places the anchor outside the face contour, not on the cheek landmark', () => {
    const left = bySide(solve(), 'left')
    const contourX = CENTRE_X - 128
    expect(left.x).toBeLessThan(contourX)
  })

  it('hangs the anchor below the contour points it was derived from', () => {
    const left = bySide(solve(), 'left')
    /* Cluster centres sit at centre.y + 0.1875·interocular; the drop has to take it past that. */
    expect(left.y).toBeGreaterThan(240 + 0.1875 * 128)
  })

  it('carries head roll through to the targets', () => {
    const targets = solve({ roll: 0.2 })
    expect(targets).toHaveLength(2)
    for (const target of targets) expect(target.rotation).toBeCloseTo(0.2, 9)
  })
})

describe('solveEarrings — scale invariance', () => {
  it('doubles the offset and the drawn width when the face doubles', () => {
    const near = solve({ interocular: 64 })
    const far = solve({ interocular: 128 })

    const nearLeft = bySide(near, 'left')
    const farLeft = bySide(far, 'left')

    expect(CENTRE_X - farLeft.x).toBeCloseTo(2 * (CENTRE_X - nearLeft.x), 6)
    expect(farLeft.width).toBeCloseTo(2 * nearLeft.width, 6)
  })

  /* The reason every constant is expressed in interocular units rather than pixels: the same
     defaults have to work for a face on a phone held at arm's length and a face across the room. */
  it('keeps the anchor at the same fraction of interocular distance at any scale', () => {
    const ratios = [48, 128, 260].map((interocular) => {
      const left = bySide(solve({ interocular }), 'left')
      return (CENTRE_X - left.x) / interocular
    })

    expect(ratios[1]).toBeCloseTo(ratios[0] ?? 0, 6)
    expect(ratios[2]).toBeCloseTo(ratios[0] ?? 0, 6)
  })
})

describe('solveEarrings — calibration', () => {
  it('scales the drawn width by the size control', () => {
    const base = bySide(solve(), 'left')
    const bigger = bySide(solve({}, { ...NEUTRAL, size: 1.5 }), 'left')
    expect(bigger.width).toBeCloseTo(base.width * 1.5, 6)
  })

  it('moves both anchors outward when the outward control increases', () => {
    const base = solve()
    const pushed = solve({}, { ...NEUTRAL, outward: 0.2 })

    expect(bySide(pushed, 'left').x).toBeLessThan(bySide(base, 'left').x)
    expect(bySide(pushed, 'right').x).toBeGreaterThan(bySide(base, 'right').x)
  })

  it('moves both anchors down when the drop control increases', () => {
    const base = solve()
    const dropped = solve({}, { ...NEUTRAL, drop: 0.2 })

    expect(bySide(dropped, 'left').y).toBeGreaterThan(bySide(base, 'left').y)
    expect(bySide(dropped, 'right').y).toBeGreaterThan(bySide(base, 'right').y)
  })

  it('raises one side and lowers the other on tilt', () => {
    const base = solve()
    const tilted = solve({}, { ...NEUTRAL, tilt: 0.3 })

    const leftDelta = bySide(tilted, 'left').y - bySide(base, 'left').y
    const rightDelta = bySide(tilted, 'right').y - bySide(base, 'right').y

    expect(Math.sign(leftDelta)).toBe(-Math.sign(rightDelta))
  })

  it('is exactly neutral at the default calibration', () => {
    /* Guards against a default that has quietly absorbed a correction, which would make the sliders
       disagree with their own centre position. */
    expect(bySide(solve(), 'left').y).toBeCloseTo(
      bySide(solve({}, { ...NEUTRAL, outward: 0, drop: 0, tilt: 0 }), 'left').y,
      9,
    )
  })
})

/*
 * The anatomical anchor.
 *
 * The mesh has no ear, so the lobe's *position* cannot be read from it — but its *level* can, from
 * the base of the nose, and the solver uses that when it is available. These four tests pin the
 * behaviour the change bought: the drop follows the subject's face instead of assuming an average
 * one, and it degrades to the previous fixed answer rather than to something wild when the evidence
 * is missing or unusable.
 */
describe('solveEarrings — the anatomical anchor', () => {
  /** Where an unclamped anatomical drop puts the anchor, for a given nose-base height. */
  function anatomicalY(noseBaseY: number): number {
    return CENTRE_Y + (noseBaseY + EAR_GEOMETRY.lobeFromNoseBase) * INTEROCULAR
  }

  /* The whole point of the change. The old fixed drop gave the same answer for every face it was
     ever shown; this one moves with the face. */
  it("follows the subject's own nose base instead of assuming an average face", () => {
    for (const noseBaseY of [0.3, 0.5, 0.75]) {
      expect(bySide(solve({ noseBaseY }), 'left').y).toBeCloseTo(anatomicalY(noseBaseY), 6)
    }
  })

  /* The fallback is not a failure — it is the engine's previous behaviour, unchanged, so a frame
     without a nose base is no worse off than it was before this landed. */
  it('falls back to a fixed proportion when the frame carries no nose base', () => {
    const low = bySide(solve({ noseBaseY: 0.9, withoutNoseBase: true }), 'left')
    const high = bySide(solve({ noseBaseY: 0.2, withoutNoseBase: true }), 'left')

    /* Nothing to read, so nothing moves. */
    expect(low.x).toBeCloseTo(high.x, 9)
    expect(low.y).toBeCloseTo(high.y, 9)

    /* And it is genuinely a different answer from the anatomical one, which is why it is a fallback
       and not the whole story. */
    expect(bySide(solve({ noseBaseY: 0.9 }), 'left').y).toBeGreaterThan(low.y)
  })

  /* `lobeDrop` divides by `down.y`, so a jaw direction near horizontal makes the answer unbounded.
     A head tilted like that is not a reason to fling a piece down the subject's face.

     Nearly flat rather than exactly flat, and that distinction is the whole test. At exactly flat the
     division is caught one branch earlier by the `isFinite` check, so removing this guard would change
     nothing and the test would pin nothing. At *nearly* flat the quotient is finite and huge — around
     840px of travel for a plausible nose base — which the clamp would quietly bound into a sideways
     fling rather than a drop. This guard is what sends it to the fixed proportion instead. */
  it('refuses the anatomical drop when the jaw direction is near horizontal', () => {
    const level = CLUSTER_Y + 0.02
    const low = bySide(solve({ noseBaseY: 0.9, jawY: level }), 'left')
    const high = bySide(solve({ noseBaseY: 0.2, jawY: level }), 'left')

    expect(Number.isFinite(low.y)).toBe(true)
    /* Two faces a whole nose-length apart get the same answer, because the nose base is not being
       read at all — the fixed drop ran. */
    expect(low.x).toBeCloseTo(high.x, 9)
    expect(low.y).toBeCloseTo(high.y, 9)
  })

  it('clamps the anatomical drop so a bad nose read cannot run away', () => {
    const atCeiling = bySide(solve({ noseBaseY: 1.5 }), 'left')
    const beyond = bySide(solve({ noseBaseY: 4 }), 'left')

    /* Past the ceiling the answer stops changing... */
    expect(beyond.y).toBeCloseTo(atCeiling.y, 6)
    /* ...and it stops well above where the nose base claims the lobe is, rather than chasing it. */
    expect(beyond.y).toBeLessThan(anatomicalY(4))
  })
})

describe('solveEarrings — degenerate frames', () => {
  it('returns nothing when the scale ruler collapses', () => {
    /* `buildFaceFrame` already refuses a face this small, but the solver is public and must not
       divide by a zero interocular if it is ever reached directly. */
    const frame = syntheticFaceFrame()
    expect(solveEarrings({ ...frame, interocular: 0 }, NEUTRAL)).toEqual([])
    expect(solveEarrings({ ...frame, interocular: Number.NaN }, NEUTRAL)).toEqual([])
  })

  it('returns nothing when the size control drives the width to zero', () => {
    const frame = syntheticFaceFrame()
    expect(solveEarrings(frame, { ...NEUTRAL, size: 0 })).toEqual([])
  })
})

describe('earOpacityForYaw', () => {
  it('leaves the near side fully opaque at any yaw', () => {
    for (const yaw of [0, 0.5, 1.2, 1.5]) {
      expect(earOpacityForYaw(yaw, false)).toBe(1)
    }
  })

  it('leaves the far side fully opaque until the fade begins', () => {
    expect(earOpacityForYaw(0, true)).toBe(1)
    expect(earOpacityForYaw(YAW_FADE_START, true)).toBe(1)
  })

  it('removes the far side entirely past the end of the fade', () => {
    expect(earOpacityForYaw(YAW_FADE_END, true)).toBe(0)
    expect(earOpacityForYaw(1.4, true)).toBe(0)
  })

  it('is monotonic and continuous across the whole range', () => {
    let previous = 1
    let previousYaw = 0
    const step = 0.01

    for (let yaw = 0; yaw <= 1.6; yaw += step) {
      const opacity = earOpacityForYaw(yaw, true)
      expect(opacity).toBeLessThanOrEqual(previous + 1e-12)

      /* No jump at either end: a pop reads as a rendering fault, a fade reads as a head turn. */
      if (yaw > previousYaw) expect(Math.abs(opacity - previous)).toBeLessThan(0.1)
      previous = opacity
      previousYaw = yaw
    }
    expect(previous).toBe(0)
  })

  it('is symmetric in the sign of the yaw', () => {
    expect(earOpacityForYaw(0.8, true)).toBeCloseTo(earOpacityForYaw(-0.8, true), 12)
  })
})

describe('solveEarrings — head turn', () => {
  it('fades the far earring and keeps the near one', () => {
    const yaw = (YAW_FADE_START + YAW_FADE_END) / 2
    const targets = solve({ yaw })

    expect(targets).toHaveLength(2)
    const opacities = targets.map((t) => t.opacity).sort()
    expect(opacities[0]).toBeLessThan(1)
    expect(opacities[0]).toBeGreaterThan(MIN_DRAW_OPACITY)
    expect(opacities[1]).toBe(1)
  })

  it('drops the far earring entirely past the fade, rather than drawing it wrongly', () => {
    /* A missing earring reads as "turn back". An earring in the wrong place reads as a broken
       product, which is the worse failure. */
    const targets = solve({ yaw: 1.2 })
    expect(targets).toHaveLength(1)
    expect(targets[0]?.opacity).toBe(1)
  })

  /* Positive yaw means the face turned toward the A cluster, which sits on screen-left. So the
     screen-right earring is the one that recedes. Deriving this from geometry rather than from a
     documented index convention is what keeps a mirrored view correct. */
  it('fades the earring on the side the head turned away from', () => {
    const targets = solve({ yaw: 1.2 })
    expect(targets[0]?.side).toBe('left')
  })

  it('reverses which ear fades when the head turns the other way', () => {
    const targets = solve({ yaw: -1.2 })
    expect(targets[0]?.side).toBe('right')
  })

  it('squashes both earrings as the head turns, within bounds', () => {
    const square = solve()
    const turned = solve({ yaw: 0.5 })

    for (const target of square) expect(target.squash).toBe(1)
    for (const target of turned) {
      expect(target.squash).toBeLessThan(1)
      expect(target.squash).toBeGreaterThanOrEqual(0.45)
    }
  })

  it('never reports a squash that would collapse the asset to a line', () => {
    for (const yaw of [0, 0.6, 1.0, 1.57]) {
      for (const target of solve({ yaw })) expect(target.squash).toBeGreaterThanOrEqual(0.45)
    }
  })
})
