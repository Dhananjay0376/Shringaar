import { describe, expect, it } from 'vitest'

import { createTargetSmoother } from '../core/targetSmoother'
import type { EarSide, PlacementTarget } from '../types/frame'

/** 30fps, so a frame is 1/30 s — the real cadence this filter is tuned against. */
const FRAME_MS = 1000 / 30

function target(side: EarSide, overrides: Partial<PlacementTarget> = {}): PlacementTarget {
  return { side, x: 100, y: 200, width: 40, rotation: 0, squash: 1, opacity: 1, ...overrides }
}

function bySide(targets: readonly PlacementTarget[], side: EarSide): PlacementTarget {
  const found = targets.find((entry) => entry.side === side)
  if (!found) throw new Error(`no ${side} target`)
  return found
}

describe('createTargetSmoother', () => {
  it('passes the first sample through untouched', () => {
    const smoother = createTargetSmoother()
    const [first] = smoother.smooth([target('left', { x: 321, y: 654, width: 77 })], 1000)

    /* A cold start must not ease in from zero. Doing so would drag the earring across the screen from
       the top-left corner on its first frame, which is far more noticeable than the jitter the filter
       exists to remove. */
    expect(first?.x).toBe(321)
    expect(first?.y).toBe(654)
    expect(first?.width).toBe(77)
  })

  it('leaves a target that is not moving exactly where it is', () => {
    const smoother = createTargetSmoother()
    for (let frame = 0; frame < 20; frame += 1) {
      smoother.smooth([target('left', { x: 250 })], frame * FRAME_MS)
    }
    const [settled] = smoother.smooth([target('left', { x: 250 })], 20 * FRAME_MS)

    /* Exact, not approximate: a constant input drives the derivative to zero and the step term to
       zero, so any drift here would be a bug in the arithmetic rather than a tuning artefact. */
    expect(settled?.x).toBe(250)
  })

  it('lags a jump rather than following it in one frame', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 })], 0)
    const [moved] = smoother.smooth([target('left', { x: 200 })], FRAME_MS)

    expect(moved?.x).toBeGreaterThan(100)
    expect(moved?.x).toBeLessThan(200)
  })

  it('never overshoots the input, in either direction', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 })], 0)

    let value = 100
    for (let frame = 1; frame <= 40; frame += 1) {
      const [step] = smoother.smooth([target('left', { x: 200 })], frame * FRAME_MS)
      value = step?.x ?? Number.NaN
      /* A first-order filter is a convex combination of its inputs, so it cannot pass the target. If it
         ever does, the derivative term has been wired into the output rather than into the cutoff. */
      expect(value).toBeLessThanOrEqual(200)
      expect(value).toBeGreaterThanOrEqual(100)
    }
    /* And it does get there, rather than asymptotically refusing to. */
    expect(value).toBeCloseTo(200, 6)
  })

  it('converges on a moving target within a few frames', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 0 })], 0)

    for (let frame = 1; frame <= 30; frame += 1) {
      smoother.smooth([target('left', { x: 120 })], frame * FRAME_MS)
    }

    /* 30 frames is a second. A filter that has not closed most of a 120px step in a second is one the
       customer would experience as the earring trailing their head. */
    const [settled] = smoother.smooth([target('left', { x: 120 })], 31 * FRAME_MS)
    expect(settled?.x).toBeCloseTo(120, 3)
  })

  it('filters the two sides independently', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 }), target('right', { x: 500 })], 0)

    const both = smoother.smooth([target('left', { x: 300 }), target('right', { x: 500 })], FRAME_MS)

    expect(bySide(both, 'left').x).toBeLessThan(300)
    expect(bySide(both, 'right').x).toBe(500)
  })

  it('carries opacity and squash through the filter too', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { opacity: 1, squash: 1 })], 0)
    const [step] = smoother.smooth([target('left', { opacity: 0.2, squash: 0.5 })], FRAME_MS)

    /* The far earring fades as the head turns, and that fade is a per-frame epsilon on a noisy yaw
       estimate. Unfiltered it is a stutter, so these are smoothed along with the position. */
    expect(step?.opacity).toBeGreaterThan(0.2)
    expect(step?.opacity).toBeLessThan(1)
    expect(step?.squash).toBeGreaterThan(0.5)
    expect(step?.squash).toBeLessThan(1)
  })

  it('holds the previous value, rather than producing NaN, when two samples share a timestamp', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 })], 5000)
    const [repeated] = smoother.smooth([target('left', { x: 900 })], 5000)

    /* Zero elapsed time is not a basis for moving, and dividing by it is how a NaN reaches a canvas
       transform — where it does not throw, it just poisons every coordinate that follows. */
    expect(repeated?.x).toBe(100)
  })

  it('forgets a side that stops being reported', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 }), target('right', { x: 900 })], 0)
    expect(smoother.trackedSides).toBe(2)

    smoother.smooth([target('left', { x: 100 })], FRAME_MS)
    expect(smoother.trackedSides).toBe(1)
  })

  it('re-acquires a returned side from its new position, not its old one', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left', { x: 100 }), target('right', { x: 900 })], 0)
    smoother.smooth([target('left', { x: 100 })], FRAME_MS)

    /* A side that returns is cold, so it lands exactly where it was solved — the left earring is still
       filtered, the right one is not eased back from wherever it used to be. This is the far earring
       coming back as the head turns, and it comes back at the edge of visibility, so a slide would be
       the one thing that made the re-acquisition noticeable. */
    const [returned] = smoother.smooth([target('right', { x: 300 })], 2 * FRAME_MS)
    expect(returned?.x).toBe(300)
  })

  it('clears everything on reset', () => {
    const smoother = createTargetSmoother()
    smoother.smooth([target('left'), target('right')], 0)
    smoother.reset()

    expect(smoother.trackedSides).toBe(0)
    const [afterReset] = smoother.smooth([target('left', { x: 777 })], 10 * FRAME_MS)
    expect(afterReset?.x).toBe(777)
  })

  it('returns an empty array for an empty frame', () => {
    const smoother = createTargetSmoother()
    expect(smoother.smooth([], 0)).toEqual([])
  })
})
